import { createHash } from "crypto";
import { getRedisCache } from "../config/redis";
import { VariableRepository } from "./VariableRepository";
import { freezeVariableSnapshot, type VariableSnapshot } from "./contract";
import { variableSnapshotLoads, variableSnapshotLoadSeconds, variableSnapshotBytes, variableSnapshotCount } from "../utils/metrics";

export const variablesEnabled = () => process.env.WORKFLOW_VARIABLES_ENABLED === "true";
const cacheKey = (owner: string, revision: string) => `coreza:vars:v1:${createHash("sha256").update(owner).digest("hex")}:${revision}`;
async function optionalCache<T>(operation: () => Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Cache timeout")), 500); })]); }
  catch { console.warn("[Variables] Cache unavailable; using PostgreSQL"); return undefined; }
  finally { if (timer) clearTimeout(timer); }
}
export class VariableSnapshotService {
  private readonly pending = new Map<string, Promise<VariableSnapshot>>();
  constructor(private readonly repository = new VariableRepository()) {}
  async load(owner: string): Promise<VariableSnapshot> {
    if (!variablesEnabled()) return Promise.reject(new Error("Workflow variables are disabled"));
    if (!/^[0-9a-f-]{36}$/i.test(owner)) return Promise.reject(new Error("Invalid variable owner"));
    const started = performance.now();
    const revision = await this.repository.revision(owner);
    const scope = cacheKey(owner, revision);
    const existing = this.pending.get(scope); if (existing) return existing;
    if (this.pending.size >= 128) return Promise.reject(new Error("Variable snapshot initialization busy"));
    const promise = this.read(owner, revision, started).finally(() => { this.pending.delete(scope); });
    this.pending.set(scope, promise); return promise;
  }
  private async read(owner: string, revision: string, started: number): Promise<VariableSnapshot> {
    // PostgreSQL revision verification is mandatory even on cache hits: no stale trading startup.
    const cached = await optionalCache(() => getRedisCache().get(cacheKey(owner, revision)));
    if (cached) {
      try {
        if (Buffer.byteLength(cached) > 131072) throw new Error("Oversize cache");
        const snapshot = freezeVariableSnapshot(JSON.parse(cached), owner);
        if (snapshot.revision !== revision || snapshot.loadedAt > Date.now() + 5000 || Date.now() - snapshot.loadedAt > 3600000) throw new Error("Stale cache");
        variableSnapshotLoads.inc({ source: "cache", status: "success" });
        variableSnapshotLoadSeconds.observe({ source: "cache" }, (performance.now() - started) / 1000);
        variableSnapshotBytes.observe(Buffer.byteLength(JSON.stringify(snapshot.entries)));
        variableSnapshotCount.observe(snapshot.entries.length);
        return snapshot;
      } catch { console.warn("[Variables] Invalid cache record; using PostgreSQL"); }
    }
    let snapshot: VariableSnapshot;
    try { snapshot = await this.repository.snapshot(owner); }
    catch (error) { variableSnapshotLoads.inc({ source: "database", status: "error" }); throw error; }
    const ttl = Math.max(30, Math.min(3600, Number(process.env.WORKFLOW_VARIABLE_CACHE_TTL_SECONDS) || 300));
    await optionalCache(() => getRedisCache().set(cacheKey(owner, snapshot.revision), JSON.stringify(snapshot), "EX", Math.floor(ttl * (0.9 + Math.random() * 0.1))));
    variableSnapshotLoads.inc({ source: "database", status: "success" });
    variableSnapshotLoadSeconds.observe({ source: "database" }, (performance.now() - started) / 1000);
    variableSnapshotBytes.observe(Buffer.byteLength(JSON.stringify(snapshot.entries)));
    variableSnapshotCount.observe(snapshot.entries.length);
    return snapshot;
  }
  async mutate(owner: string, revision: string, operation: "create" | "update" | "delete", key: string, value: unknown) {
    const result = await this.repository.mutate(owner, revision, operation, key, value);
    await optionalCache(() => getRedisCache().del(cacheKey(owner, revision)));
    return result;
  }
}
export const variableSnapshots = new VariableSnapshotService();
