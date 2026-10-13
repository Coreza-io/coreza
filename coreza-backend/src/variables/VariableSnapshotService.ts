import { createHash } from "crypto";
import { getRedisCache } from "../config/redis";
import { VariableRepository } from "./VariableRepository";
import { freezeVariableSnapshot, validateVariable, overlayVariables, type VariableChange, type VariableSnapshot } from "./contract";
import { variableSnapshotLoads, variableSnapshotLoadSeconds, variableSnapshotBytes, variableSnapshotCount } from "../utils/metrics";

const cacheKey = (owner: string, revision: string, workflowId?: string) => `coreza:vars:v1:${createHash("sha256").update(JSON.stringify([owner, workflowId ?? "global"])).digest("hex")}:${revision}`;
async function optionalCache<T>(operation: () => Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Cache timeout")), 500); })]); }
  catch { console.warn("[Variables] Cache unavailable; using PostgreSQL"); return undefined; }
  finally { if (timer) clearTimeout(timer); }
}
export class VariableSnapshotService {
  private readonly pending = new Map<string, Promise<VariableSnapshot>>();
  constructor(private readonly repository = new VariableRepository()) {}
  async load(owner: string, workflowId?: string): Promise<VariableSnapshot> {
    if (!/^[0-9a-f-]{36}$/i.test(owner)) return Promise.reject(new Error("Invalid variable owner"));
    if (workflowId !== undefined && !/^[0-9a-f-]{36}$/i.test(workflowId)) throw new Error("Save the workflow before using persistent variables");
    if (workflowId && process.env.LIVE_VARIABLE_WRITE_BEHIND_ENABLED === "true") {
      const { liveRPC, decodeCheckpoint } = await import("./LiveVariableProtocol");
      const source = await liveRPC("source", owner, workflowId);
      if (source.active) {
        if (!source.payload) throw new Error("Live variable recovery pending");
        const { checkpoint } = decodeCheckpoint(source.payload, source.hash, owner, workflowId);
        return Object.freeze({ ...checkpoint.snapshot, checkpoint: Object.freeze({ epoch: checkpoint.epoch, writerFence: checkpoint.fence, sqlCheckpointGeneration: checkpoint.generation, source: "sql-checkpoint" as const }) });
      }
    }
    const started = performance.now();
    let revision: string;
    try { revision = await this.repository.revision(owner, workflowId); }
    catch (error) {
      // Read routing survives writer-flag rollback, without probing the new RPC
      // on ordinary flag-off scopes or serving their old legacy cache entries.
      if (!(error as any).liveOwned || !workflowId) throw error;
      const { liveRPC, decodeCheckpoint } = await import("./LiveVariableProtocol");
      const source = await liveRPC("source", owner, workflowId);
      if (!source.active || !source.payload) throw new Error("Live variable source transition pending; retry initialization");
      const { checkpoint } = decodeCheckpoint(source.payload, source.hash, owner, workflowId);
      return Object.freeze({ ...checkpoint.snapshot, checkpoint: Object.freeze({ epoch: checkpoint.epoch, writerFence: checkpoint.fence, sqlCheckpointGeneration: checkpoint.generation, source: "sql-checkpoint" as const }) });
    }
    const scope = cacheKey(owner, revision, workflowId);
    const existing = this.pending.get(scope); if (existing) return existing;
    if (this.pending.size >= 128) return Promise.reject(new Error("Variable snapshot initialization busy"));
    const promise = this.read(owner, revision, started, workflowId).finally(() => { this.pending.delete(scope); });
    this.pending.set(scope, promise); return promise;
  }
  private async read(owner: string, revision: string, started: number, workflowId?: string): Promise<VariableSnapshot> {
    // PostgreSQL revision verification is mandatory even on cache hits: no stale trading startup.
    const cached = await optionalCache(() => getRedisCache().get(cacheKey(owner, revision, workflowId)));
    if (cached) {
      try {
        if (Buffer.byteLength(cached) > 131072) throw new Error("Oversize cache");
        const snapshot = freezeVariableSnapshot(JSON.parse(cached), owner, workflowId);
        if (snapshot.revision !== revision || snapshot.loadedAt > Date.now() + 5000 || Date.now() - snapshot.loadedAt > 3600000) throw new Error("Stale cache");
        variableSnapshotLoads.inc({ source: "cache", status: "success" });
        variableSnapshotLoadSeconds.observe({ source: "cache" }, (performance.now() - started) / 1000);
        variableSnapshotBytes.observe(Buffer.byteLength(JSON.stringify(snapshot.entries)));
        variableSnapshotCount.observe(snapshot.entries.length);
        return snapshot;
      } catch { console.warn("[Variables] Invalid cache record; using PostgreSQL"); }
    }
    let snapshot: VariableSnapshot;
    try { snapshot = await this.repository.snapshot(owner, workflowId); }
    catch (error) { variableSnapshotLoads.inc({ source: "database", status: "error" }); throw error; }
    const ttl = Math.max(30, Math.min(3600, Number(process.env.WORKFLOW_VARIABLE_CACHE_TTL_SECONDS) || 300));
    await optionalCache(() => getRedisCache().set(cacheKey(owner, snapshot.revision, workflowId), JSON.stringify(snapshot), "EX", Math.floor(ttl * (0.9 + Math.random() * 0.1))));
    variableSnapshotLoads.inc({ source: "database", status: "success" });
    variableSnapshotLoadSeconds.observe({ source: "database" }, (performance.now() - started) / 1000);
    variableSnapshotBytes.observe(Buffer.byteLength(JSON.stringify(snapshot.entries)));
    variableSnapshotCount.observe(snapshot.entries.length);
    return snapshot;
  }
  async commit(snapshot: VariableSnapshot, changes: readonly VariableChange[], token: string): Promise<VariableSnapshot> {
    if (!snapshot.workflowId) throw new Error("Save the workflow before using persistent variables");
    if (snapshot.checkpoint) throw new Error("Live variable scope is owned; stop and hand off before manual Persistent edits");
    for (const { key, value } of changes) validateVariable(key, value);
    if (new Set(changes.map(change => change.key)).size !== changes.length) throw new Error("Duplicate persistent variable name");
    if (changes.every(({ key, value }) => Object.prototype.hasOwnProperty.call(snapshot.values, key) && snapshot.values[key] === value)) {
      // A scope may have become live-owned since this legacy execution loaded.
      // Recheck admission even for a no-op; this reads but never writes SQL.
      await this.repository.revision(snapshot.owner, snapshot.workflowId);
      return snapshot;
    }
    overlayVariables(snapshot, changes); // Validate aggregate limits before any I/O.
    const committed = await this.repository.commit(snapshot.owner, snapshot.workflowId, snapshot.revision, token, changes);
    if (BigInt(committed.revision) < BigInt(snapshot.revision)) throw new Error("Variable replay would regress the run snapshot");
    await optionalCache(() => getRedisCache().del(cacheKey(snapshot.owner, snapshot.revision, snapshot.workflowId)));
    return committed;
  }
  async mutate(owner: string, revision: string, operation: "create" | "update" | "delete", key: string, value: unknown) {
    const result = await this.repository.mutate(owner, revision, operation, key, value);
    await optionalCache(() => getRedisCache().del(cacheKey(owner, revision)));
    return result;
  }
}
export const variableSnapshots = new VariableSnapshotService();
