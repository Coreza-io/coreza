import { RedisKeys } from "../infra/redisKeys";
import { LIVE_BUCKETS, decodeCheckpoint, liveCommand, liveKeys, liveRPC, withLiveRedis } from "../variables/LiveVariableProtocol";

/** Separate worker role: bounded dirty-scope scans, never one job per mutation. */
export class LiveVariableCheckpointWorker {
  private timer?: ReturnType<typeof setInterval>;
  private task?: Promise<void>;
  private bucket = 0;
  private readonly cursors = Array<string>(LIVE_BUCKETS).fill("0");
  private readonly repairCursors = Array<string>(LIVE_BUCKETS).fill("0");
  private inventoryAfter?: string;
  private inventoryDue = 0;
  private readonly due = new Map<string, number>();

  start(): void {
    if (this.timer || process.env.LIVE_VARIABLE_CHECKPOINT_WORKER_ENABLED !== "true") return;
    this.timer = setInterval(() => {
      if (this.task) return;
      this.task = this.scan().catch(() => console.warn("[LiveVariables] Checkpoint worker unavailable; dirty state retained")).finally(() => { this.task = undefined; });
    }, 125);
    this.timer.unref();
  }
  async stop(): Promise<void> { if (this.timer) clearInterval(this.timer); this.timer = undefined; await this.task; }

  private async scan(): Promise<void> {
    const bucket = this.bucket;
    this.bucket = (bucket + 1) % LIVE_BUCKETS;
    // Repair lost markers independently of the notification/index path.
    const [repairCursor, keys] = await withLiveRedis(redis => redis.scan(this.repairCursors[bucket], "MATCH", `coreza:livevars:{lv:${bucket}}:scope:*:checkpoint`, "COUNT", 8));
    this.repairCursors[bucket] = repairCursor;
    for (const key of keys.slice(0, 16)) {
      const data = await withLiveRedis(redis => redis.hgetall(key));
      if (!data.owner || !data.workflow || liveKeys(data.owner, data.workflow).checkpoint !== key) throw new Error("Checkpoint scope binding invalid");
      if (!data.sqlGeneration || BigInt(data.generation) > BigInt(data.sqlGeneration)) await withLiveRedis(redis => redis.sadd(RedisKeys.liveVariableDirty(bucket), liveKeys(data.owner, data.workflow).member));
    }
    const [cursor, members] = await withLiveRedis(redis => redis.sscan(RedisKeys.liveVariableDirty(bucket), this.cursors[bucket], "COUNT", 8));
    this.cursors[bucket] = cursor;
    // Two SQL tasks at a time, at most one marker/deadline per admitted scope.
    for (let offset = 0; offset < Math.min(members.length, 16); offset += 2) {
      await Promise.all(members.slice(offset, offset + 2).map(member => this.checkpoint(bucket, member)));
    }
    if (performance.now() >= this.inventoryDue) {
      this.inventoryDue = performance.now() + 2000;
      const page = await liveRPC("inventory", "00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000", { after: this.inventoryAfter });
      for (const scope of page.scopes) {
        const scopeKeys = liveKeys(scope.owner, scope.workflow);
        const present = await withLiveRedis(redis => redis.exists(scopeKeys.checkpoint));
        if (!present) console.warn("[LiveVariables] Recovery checkpoint missing; scope requires repair");
      }
      this.inventoryAfter = page.scopes.length === 32 ? page.scopes[31].workflow : undefined;
    }
  }
  private async checkpoint(bucket: number, member: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(member)) throw new Error("Invalid dirty member");
    const now = performance.now();
    if (now < (this.due.get(member) ?? 0)) return;
    if (!this.due.has(member) && this.due.size >= 128) {
      const expired = [...this.due].find(([, deadline]) => deadline <= now);
      if (!expired) return;
      this.due.delete(expired[0]);
    }
    this.due.set(member, now + 2000);
    try {
      const keys = RedisKeys.liveVariableScope(bucket, member);
      const record = await withLiveRedis(redis => redis.hgetall(keys.checkpoint));
      if (!record.payload || liveKeys(record.owner, record.workflow).member !== member) throw new Error("Dirty checkpoint missing");
      const encoded = decodeCheckpoint(record.payload, record.hash, record.owner, record.workflow);
      const e = encoded.checkpoint;
      if (record.epoch !== e.epoch || record.fence !== e.fence || record.generation !== e.generation) throw new Error("Checkpoint envelope binding invalid");
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
