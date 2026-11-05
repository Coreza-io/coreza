import { randomUUID } from "crypto";
import { freezeVariableSnapshot, type VariableSnapshot } from "./contract";
import { LiveVariableSafetyStop, LiveVariableState, type SettledVariables } from "./LiveVariableState";
import { decodeCheckpoint, decodeLiveRecord, encodeCheckpoint, fields, liveCommand, liveKeys, liveRPC, liveRedisClock, redisLeaseDeadline, liveDecimal, sameVersion, version, type EncodedCheckpoint } from "./LiveVariableProtocol";
import { liveVariableResources, liveVariableOperations } from "../utils/metrics";

// Retained only to finish/recover pre-cutover ownership. New runs are ephemeral.
export const liveVariablesEnabled = () => false;
const scopes = new Map<string, string>();
const sessions = new Map<string, LiveVariableSession>();
let scheduler: ReturnType<typeof setInterval> | undefined;
let cursor = 0;
function register(session: LiveVariableSession, key: string): void {
  sessions.set(key, session);
  scheduler ??= setInterval(() => {
    const active = [...sessions.values()];
    if (!active.length) return;
    const stats = active.map(s => s.state.metadata);
    liveVariableResources.set({ kind: "scopes" }, active.length);
    liveVariableResources.set({ kind: "dirty_keys" }, stats.reduce((sum, s) => sum + s.dirtyKeys, 0));
    liveVariableResources.set({ kind: "entries_budget_bytes" }, stats.reduce((sum, s) => sum + s.entriesBudgetBytes, 0));
    liveVariableResources.set({ kind: "max_redis_coverage_ms" }, Math.max(...stats.map(s => s.redisCoverageAgeMs)));
    liveVariableResources.set({ kind: "max_sql_coverage_ms" }, Math.max(...stats.map(s => s.sqlCoverageAgeMs)));
    // Rotate a fixed dispatch budget fairly; completions never trigger a flush loop.
    for (let i = 0; i < Math.min(4, active.length); i++) active[(cursor + i) % active.length].schedule();
    cursor = (cursor + Math.min(4, active.length)) % active.length;
  }, 100);
  scheduler.unref();
}
function unregister(session: LiveVariableSession, key: string): void {
  if (sessions.get(key) === session) sessions.delete(key);
  liveVariableResources.set({ kind: "scopes" }, sessions.size);
  if (!sessions.size && scheduler) {
    clearInterval(scheduler); scheduler = undefined; cursor = 0;
    for (const kind of ["dirty_keys", "entries_budget_bytes", "max_redis_coverage_ms", "max_sql_coverage_ms"]) liveVariableResources.set({ kind }, 0);
  }
}
export class LiveVariableSession {
  readonly state: LiveVariableState;
  private task?: Promise<void>;
  private stopTask?: Promise<void>;
  private pending?: { encoded: EncodedCheckpoint; captured: SettledVariables };
  private nextPublish = 0;
  private nextRenew = 0;
  private nextProgress = 0;
  private failures = 0;
  private stopping = false;
  private requiresRecovery = false;
  private handoff?: { generation: string; hash: string };
  private readonly key: string;

  private constructor(private readonly owner: string, private readonly workflow: string,
    private readonly writer: string, private readonly base: EncodedCheckpoint, private readonly onPause: () => void) {
    this.state = new LiveVariableState(base.checkpoint.snapshot);
    this.key = liveKeys(owner, workflow).member;
  }

  static async open(owner: string, workflow: string, onPause: () => void): Promise<LiveVariableSession | undefined> {
    if (!liveVariablesEnabled()) return undefined;
    const policy = await liveRPC("eligible", owner, workflow);
    if (!policy.eligible) {
      if (policy.owned) throw new Error("Live variable scope is owned; recovery or handoff required");
      return undefined;
    }
    const key = liveKeys(owner, workflow).member;
    if (scopes.has(key) || scopes.size >= 16) throw new Error("Live variable active scope limit/ownership conflict");
    // Operators attest queue durability independently of ordinary cache Redis.
    if (process.env.LIVE_VARIABLE_REDIS_DURABILITY_VERIFIED !== "true") throw new Error("Live variable Redis durability has not been verified");
    const writer = randomUUID();
    scopes.set(key, writer);
    const epoch = randomUUID();
    try {
      const clock = await liveRedisClock();
      const started = performance.now();
      const authority = await liveRPC("claim", owner, workflow, { writer });
      const deadline = started + authority.lease_ms - 2000;
      const redisDeadline = redisLeaseDeadline(deadline, clock);
      const sealed = fields(await liveCommand(owner, workflow, authority.fence, epoch, "seal", [redisDeadline]));
      const sql = authority.payload ? decodeCheckpoint(authority.payload, authority.hash, owner, workflow) : undefined;
      const redis = Object.keys(sealed).length ? decodeLiveRecord(sealed, owner, workflow) : undefined;
      let selected = sql;
      if (sql && redis) {
        const a = sql.checkpoint; const b = redis.checkpoint;
        if (a.epoch === b.epoch && a.fence === b.fence) {
          if (a.generation === b.generation && sql.hash !== redis.hash) throw new Error("Live variable recovery hash conflict");
          if (BigInt(a.generation) > BigInt(b.generation) && !authority.fresh) throw new Error("SQL checkpoint is ahead of Redis; explicit topology repair required");
          selected = BigInt(b.generation) > BigInt(a.generation) ? redis : sql;
        } else if (sameVersion(a.parent, version(redis)) && a.generation === "0") selected = sql;
        else throw new Error("Live variable recovery lineage mismatch");
      } else if (sql && !redis && !authority.fresh) throw new Error("Authoritative Redis checkpoint missing; explicit repair required");
      else if (!sql && redis) throw new Error("Unexpected Redis checkpoint; explicit repair required");
      // The legacy revision remains the SQL configuration revision, never a live generation.
      const snapshot = freezeVariableSnapshot({ ...(authority.fresh ? authority.snapshot : selected?.checkpoint.snapshot ?? authority.snapshot), revision: authority.legacy_revision, loadedAt: Date.now() }, owner, workflow);
      const base = encodeCheckpoint({ schemaVersion: 1, epoch, fence: authority.fence, generation: "0", parent: selected ? version(selected) : null, snapshot, capturedAt: performance.now(), source: selected?.checkpoint.source ?? { event: "initial", outcome: "success" } });
      // Admission validates the conservative budget before installing a new epoch.
      const session = new LiveVariableSession(owner, workflow, writer, base, onPause);
      await liveRPC("prepare", owner, workflow, { writer, fence: authority.fence, payload: base.payload, hash: base.hash, parent_payload: selected?.payload ?? null, parent_hash: selected?.hash ?? null });
      await liveCommand(owner, workflow, authority.fence, epoch, "init", [redisDeadline, base.payload, base.hash, "0", key]);
      await liveRPC("activate", owner, workflow, { writer, fence: authority.fence, epoch, hash: base.hash });
      await liveCommand(owner, workflow, authority.fence, epoch, "ack", ["0", epoch, authority.fence, "0", key, base.hash, String(base.checkpoint.capturedAt)]);
      session.state.leaseDeadline = deadline;
      session.nextRenew = performance.now() + 5000;
      register(session, key);
      return session;
    } catch (error) { if (scopes.get(key) === writer) scopes.delete(key); throw error; }
  }

  assertAdmission(): void {
    if (!liveVariablesEnabled()) this.pause();
    try { this.state.assertAdmission(); } catch (error) { this.pause(); throw error; }
  }
  private pause(): void {
    if (this.requiresRecovery) return;
    this.requiresRecovery = true;
    if (this.state.lifecycle === "active") this.state.lifecycle = "paused";
    this.onPause();
  }
  schedule(): void {
    if (!this.stopping && this.state.lifecycle === "active") {
      try { this.assertAdmission(); } catch { this.pause(); }
    }
    if (this.task || this.stopping) return;
    this.task = this.pump().catch(error => {
      if (error instanceof LiveVariableSafetyStop || /live-variable-(authority|stale-fence|hash-conflict|epoch|sql-hash-conflict)/.test(String(error?.message))) this.pause();
      this.failures = Math.min(this.failures + 1, 6);
      this.nextPublish = performance.now() + Math.min(5000, 100 * 2 ** this.failures) * (0.8 + Math.random() * 0.4);
      // Retain the exact ambiguous receipt, not a newly captured generation.
    }).finally(() => { this.task = undefined; });
  }
  private async pump(): Promise<void> {
    const now = performance.now();
    const { epoch, fence } = this.base.checkpoint;
    if (now >= this.nextRenew && this.state.lifecycle === "active") {
      this.nextRenew = now + 5000;
      try {
        const clock = await liveRedisClock();
        const started = performance.now();
        const authority = await liveRPC("renew", this.owner, this.workflow, { writer: this.writer, fence, epoch });
        const deadline = started + authority.lease_ms - 2000;
        await liveCommand(this.owner, this.workflow, fence, epoch, "renew", [redisLeaseDeadline(deadline, clock)]);
        this.state.leaseDeadline = deadline;
      } catch (error) {
        if (error instanceof LiveVariableSafetyStop || /live-variable-(authority|stale-fence|sealed)/.test(String((error as Error)?.message))) throw error;
        if ((error as any).liveBusy) this.nextRenew = performance.now() + 250;
        // Retain the last confirmed deadline. A transient SQL heartbeat failure
        // must not suppress an otherwise healthy Redis checkpoint until expiry.
      }
    }
    if (now < this.nextPublish) return;
    this.nextPublish = now + 250;
    if (!this.pending && this.state.settled.generation > this.state.redisGeneration) {
      const captured = this.state.settled;
      const encoded = encodeCheckpoint({ ...this.base.checkpoint, generation: captured.generation.toString(), capturedAt: captured.capturedAt, source: captured.source, snapshot: { ...this.base.checkpoint.snapshot, entries: captured.entries } });
      this.pending = { encoded, captured };
    }
    if (this.pending) {
      const { encoded, captured } = this.pending;
      const receipt = fields(await liveCommand(this.owner, this.workflow, fence, epoch, "publish", ["0", encoded.payload, encoded.hash, encoded.checkpoint.generation, this.key]));
      if (receipt.epoch !== epoch || receipt.fence !== fence || receipt.generation !== encoded.checkpoint.generation || receipt.hash !== encoded.hash) throw new LiveVariableSafetyStop("Live checkpoint receipt mismatch");
      this.state.acknowledge(captured);
      this.progress(receipt);
      this.pending = undefined;
      this.failures = 0;
    } else if (now >= this.nextProgress && this.state.generation > this.state.sqlGeneration) {
      this.nextProgress = now + 2000;
      this.progress(fields(await liveCommand(this.owner, this.workflow, fence, epoch, "read")));
    }
  }
  private progress(receipt: Record<string, string>): void {
    if (receipt.epoch !== this.base.checkpoint.epoch || receipt.fence !== this.base.checkpoint.fence) throw new LiveVariableSafetyStop("Live checkpoint epoch changed");
    const capturedAt = Number(receipt.sqlCapturedAt);
    if (receipt.sqlGeneration !== undefined) {
      if (!liveDecimal(receipt.sqlGeneration) || !/^[a-f0-9]{64}$/.test(receipt.sqlHash ?? "") || !Number.isFinite(capturedAt) || capturedAt < 0 || capturedAt > performance.now()) throw new LiveVariableSafetyStop("Live checkpoint SQL progress invalid");
      this.state.acknowledgeSQL(BigInt(receipt.sqlGeneration), capturedAt);
    }
  }
  get metadata() { return { epoch: this.base.checkpoint.epoch, writerFence: this.base.checkpoint.fence, recoveryRequired: this.requiresRecovery, ...this.state.metadata }; }
  get snapshot(): VariableSnapshot { return this.base.checkpoint.snapshot; }

  stop(deadline = performance.now() + 10000): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopTask = this.stopOnce(deadline).catch(error => { this.stopTask = undefined; throw error; });
    return this.stopTask;
  }
  private async stopOnce(deadline: number): Promise<void> {
    this.state.quiesce();
    this.stopping = true;
    unregister(this, this.key);
    try {
      if (this.task) await this.task;
      if (this.handoff) {
        if (performance.now() + 1500 > deadline) throw new Error("Live variable handoff reconciliation deadline exceeded");
        await liveRPC("handoff", this.owner, this.workflow, { writer: this.writer, fence: this.base.checkpoint.fence, epoch: this.base.checkpoint.epoch, ...this.handoff });
        this.state.lifecycle = "stopped";
        return;
      }
      const target = this.state.generation;
      while (this.state.redisGeneration < target && performance.now() + 2000 < deadline) {
        try { await this.pump(); } catch { /* Retry the same captured identity within the lifecycle budget. */ }
        if (this.state.redisGeneration < target) await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (this.state.redisGeneration < target || performance.now() >= deadline) throw new Error("Live variable stop incomplete: Redis pending");
      const { epoch, fence } = this.base.checkpoint;
      const budget = (ms: number) => { if (performance.now() + ms > deadline) throw new Error("Live variable stop incomplete: deadline exceeded"); };
      budget(2000);
      const stored = fields(await liveCommand(this.owner, this.workflow, fence, epoch, "read"));
      const encoded = decodeLiveRecord(stored, this.owner, this.workflow);
      if (encoded.checkpoint.epoch !== epoch || encoded.checkpoint.fence !== fence || BigInt(encoded.checkpoint.generation) !== target) throw new Error("Live variable stop target mismatch");
      budget(1500);
      const sql = await liveRPC("checkpoint", this.owner, this.workflow, { payload: encoded.payload, hash: encoded.hash, priority: true, writer: this.writer, fence });
      if (sql.generation !== target.toString() || sql.hash !== encoded.hash) throw new Error("Live variable SQL stop target pending");
      this.state.acknowledgeSQL(target, encoded.checkpoint.capturedAt);
      budget(2000);
      await liveCommand(this.owner, this.workflow, fence, epoch, "ack", ["0", epoch, fence, target.toString(), this.key, encoded.hash, String(encoded.checkpoint.capturedAt)]);
      if (this.requiresRecovery) throw new Error("Live variable safety stop checkpointed; recovery approval required");
      // Seal Redis before SQL transfer: no late publish can race the handoff.
      budget(2000);
      await liveCommand(this.owner, this.workflow, fence, epoch, "seal", ["0"]);
      budget(1500);
      this.handoff = { generation: target.toString(), hash: encoded.hash };
      await liveRPC("handoff", this.owner, this.workflow, { writer: this.writer, fence, epoch, generation: target.toString(), hash: encoded.hash });
      this.state.lifecycle = "stopped";
    } finally {
      liveVariableOperations.inc({ operation: "stop", status: this.state.lifecycle === "stopped" ? "success" : "error" });
      if (this.state.lifecycle === "stopped") {
        if (scopes.get(this.key) === this.writer) scopes.delete(this.key);
      } else {
        // Failed drains retain both RAM capacity and background reconciliation.
        this.stopping = false;
        register(this, this.key);
      }
    }
  }
  dispose(): void {
    unregister(this, this.key);
    this.stopping = true;
    if (scopes.get(this.key) === this.writer) scopes.delete(this.key);
  }
}
