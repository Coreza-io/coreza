import { RedisKeys } from "../infra/redisKeys";
import { LIVE_BUCKETS, decodeLiveRecord, liveCommand, liveKeys, liveRPC, withLiveRedis } from "../variables/LiveVariableProtocol";

/** Separate worker role: bounded dirty-scope scans, never one job per mutation. */
export class LiveVariableCheckpointWorker {
  private timer?: ReturnType<typeof setInterval>;
  private task?: Promise<void>;
  private stopping = false;
  private bucket = 0;
  private readonly cursors = Array<string>(LIVE_BUCKETS).fill("0");
  private readonly repairCursors = Array<string>(LIVE_BUCKETS).fill("0");
  private readonly pages = new Map<string, string[]>();
  private buffered = 0;
  private inventoryAfter?: { owner: string; workflow: string };
  private inventoryPage: Array<{ owner: string; workflow: string }> = [];
  private inventoryDue = 0;
  private readonly due = new Map<string, number>();

  start(): void {
    if (this.timer || process.env.LIVE_VARIABLE_CHECKPOINT_WORKER_ENABLED !== "true") return;
    this.stopping = false;
    this.timer = setInterval(() => {
      if (this.task) return;
      this.task = this.scan().catch(() => console.warn("[LiveVariables] Checkpoint worker unavailable; dirty state retained")).finally(() => { this.task = undefined; });
    }, 125);
    this.timer.unref();
  }
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.task, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Live checkpoint worker stop incomplete; tasks pending")), 10000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }

  private async takePage(bucket: number, repair: boolean): Promise<string[]> {
    const id = `${repair ? "repair" : "dirty"}:${bucket}`;
    if (!this.pages.has(id)) {
      const capacity = 128 - this.buffered;
      if (capacity <= 0) return [];
      const cursors = repair ? this.repairCursors : this.cursors;
      const [next, items] = await withLiveRedis(redis => repair
        ? redis.scan(cursors[bucket], "MATCH", `coreza:livevars:{lv:${bucket}}:scope:*:checkpoint`, "COUNT", Math.min(8, capacity))
        : redis.sscan(RedisKeys.liveVariableDirty(bucket), cursors[bucket], "COUNT", Math.min(8, capacity)));
      // COUNT is a hint, not a page-size guarantee. Never advance past an
      // unbuffered tail; retry this cursor after existing pages free capacity.
      if (items.length > capacity) {
        console.warn("[LiveVariables] Scan page exceeds capacity; cursor retained");
        return [];
      }
      this.pages.set(id, items);
      this.buffered += items.length;
      cursors[bucket] = next;
    }
    const page = this.pages.get(id)!;
    const batch = page.splice(0, 2);
    this.buffered -= batch.length;
    if (!page.length) this.pages.delete(id);
    return batch;
  }
  private async scan(): Promise<void> {
    const bucket = this.bucket;
    this.bucket = (bucket + 1) % LIVE_BUCKETS;
    // Repair is isolated per key; a corrupt key must not starve healthy scopes.
    for (const key of await this.takePage(bucket, true)) {
      if (this.stopping) return;
      try {
        const data = await withLiveRedis(redis => redis.hgetall(key));
        if (!data.owner || !data.workflow || liveKeys(data.owner, data.workflow).checkpoint !== key) throw new Error("Checkpoint scope binding invalid");
        decodeLiveRecord(data, data.owner, data.workflow);
        if (!data.sqlGeneration || BigInt(data.generation) > BigInt(data.sqlGeneration)) await withLiveRedis(redis => redis.sadd(RedisKeys.liveVariableDirty(bucket), liveKeys(data.owner, data.workflow).member));
      } catch { console.warn("[LiveVariables] Checkpoint repair pending; other scopes continue"); }
    }
    if (this.stopping) return;
    // One small batch per bucket turn, rather than draining a hot bucket first.
    await Promise.all((await this.takePage(bucket, false)).map(member => this.checkpoint(bucket, member)));
    if (this.stopping) return;
    if (!this.inventoryPage.length && performance.now() >= this.inventoryDue) {
      this.inventoryDue = performance.now() + 2000;
      const page = await liveRPC("inventory", "00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000", { after: this.inventoryAfter });
      if (!Array.isArray(page.scopes) || page.scopes.length > 32) throw new Error("Invalid live scope inventory page");
      this.inventoryPage = page.scopes;
      this.inventoryAfter = page.scopes.length === 32 ? page.scopes[31] : undefined;
    }
    for (const scope of this.inventoryPage.splice(0, 2)) {
      if (this.stopping) return;
      try {
        const scopeKeys = liveKeys(scope.owner, scope.workflow);
        const present = await withLiveRedis(redis => redis.exists(scopeKeys.checkpoint));
        if (!present) console.warn("[LiveVariables] Recovery checkpoint missing; scope requires repair");
      } catch { console.warn("[LiveVariables] Inventory reconciliation pending"); }
    }
  }
  private async checkpoint(bucket: number, member: string): Promise<void> {
    try {
      if (!/^[a-f0-9]{64}$/.test(member)) throw new Error("Invalid dirty member");
      const now = performance.now();
      if (now < (this.due.get(member) ?? 0)) return;
      if (!this.due.has(member) && this.due.size >= 128) {
        const expired = [...this.due].find(([, deadline]) => deadline <= now);
        if (!expired) return;
        this.due.delete(expired[0]);
      }
      this.due.set(member, now + 2000);
      const keys = RedisKeys.liveVariableScope(bucket, member);
      const record = await withLiveRedis(redis => redis.hgetall(keys.checkpoint));
      if (!record.payload || liveKeys(record.owner, record.workflow).checkpoint !== keys.checkpoint) throw new Error("Dirty checkpoint missing");
      const encoded = decodeLiveRecord(record, record.owner, record.workflow);
      const e = encoded.checkpoint;
      const result = await liveRPC("checkpoint", record.owner, record.workflow, { payload: encoded.payload, hash: encoded.hash });
      if (result.generation !== e.generation || result.hash !== encoded.hash) return;
      // Read current authority: a sealed parent's checkpoint can be persisted,
      // but its acknowledgement must never clear a child epoch's dirty marker.
      const authority = await withLiveRedis(redis => redis.get(keys.authority));
      if (!authority) throw new Error("Checkpoint authority missing");
      const a = JSON.parse(authority);
      await liveCommand(record.owner, record.workflow, a.fence, a.epoch, "ack", ["0", e.epoch, e.fence, e.generation, member, encoded.hash, String(e.capturedAt)]);
    } catch { console.warn("[LiveVariables] SQL checkpoint pending; marker retained"); }
  }
}
export const liveVariableCheckpointWorker = new LiveVariableCheckpointWorker();
