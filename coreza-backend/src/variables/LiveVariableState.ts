import { VARIABLE_LIMITS, validateVariable, type VariableChange, type VariableEntry, type VariableSnapshot, type VariableValue } from "./contract";

export class LiveVariableSafetyStop extends Error {
  constructor(message: string) { super(message); this.name = "LiveVariableSafetyStop"; }
}
export interface SettledVariables {
  generation: bigint;
  entries: readonly VariableEntry[];
  capturedAt: number;
  source: { event: string; outcome: "success" | "failed" | "cancelled" };
}

// Budget PostgreSQL's JSONB separators and expanded numeric representation too.
// This is deliberately conservative, rather than claiming JS/JSONB byte parity.
const entryBytes = (entry: VariableEntry) => Buffer.byteLength(JSON.stringify(entry)) + 10 + (typeof entry.value === "number" ? 330 : 0);
export class LiveVariableState {
  values: Readonly<Record<string, VariableValue>>;
  generation = 0n;
  redisGeneration = 0n;
  sqlGeneration = 0n;
  readonly dirty = new Map<string, bigint>();
  lifecycle: "active" | "paused" | "quiescing" | "stopped" = "active";
  leaseDeadline = 0;
  redisCoverage = performance.now();
  sqlCoverage = performance.now();
  settled: SettledVariables;
  private entries: Map<string, Readonly<VariableEntry>>;
  private sizes: Map<string, number>;
  private bytes: number;
  private eventStarted?: number;
  private event = "initial";
  private noops = 0;

  constructor(snapshot: VariableSnapshot) {
    this.values = snapshot.values;
    this.entries = new Map(snapshot.entries.map(e => [e.key, e]));
    this.sizes = new Map(snapshot.entries.map(e => [e.key, entryBytes(e)]));
    this.bytes = 2 + [...this.sizes.values()].reduce((a, b) => a + b, 0) + Math.max(0, this.entries.size - 1);
    if (this.bytes > VARIABLE_LIMITS.snapshotBytes) throw new Error("Live variable conservative byte budget exceeded");
    this.settled = { generation: 0n, entries: snapshot.entries, capturedAt: performance.now(), source: { event: "initial", outcome: "success" } };
  }

  assertAdmission(): void {
    const now = performance.now();
    const redisPending = this.dirty.size > 0;
    const sqlPending = this.generation > this.sqlGeneration;
    if (this.lifecycle !== "active" || now >= this.leaseDeadline ||
      (redisPending && now - this.redisCoverage >= 2000) ||
      (sqlPending && now - this.sqlCoverage >= 30000) ||
      (this.eventStarted !== undefined && now - this.eventStarted >= 2000)) {
      this.lifecycle = "paused";
      throw new LiveVariableSafetyStop("Live variable lease or checkpoint coverage unavailable; recovery required");
    }
  }

  apply(changes: readonly VariableChange[]): void {
    this.assertAdmission();
    if (changes.length > VARIABLE_LIMITS.count) throw new Error("Live variable batch count limit exceeded");
    const staged = new Map<string, Readonly<VariableEntry>>();
    const stagedSizes = new Map<string, number>();
    let bytes = this.bytes;
    let added = 0;
    const names = new Set<string>();
    for (const { key, value } of changes) {
      validateVariable(key, value);
      if (typeof value === "string" && /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) throw new Error("Live variable strings must be valid PostgreSQL UTF-8 text");
      if (names.has(key)) throw new Error("Duplicate persistent variable name");
      names.add(key);
      if (this.entries.has(key) && this.values[key] === value) continue;
      const entry = Object.freeze({ key, value, value_type: value === null ? "null" : typeof value, updated_at: new Date().toISOString() });
      const size = entryBytes(entry);
      bytes += size - (this.sizes.get(key) ?? 0);
      if (!this.entries.has(key)) { if (this.entries.size + added > 0) bytes++; added++; }
      staged.set(key, entry);
      stagedSizes.set(key, size);
    }
    if (!staged.size) { this.noops++; return; }
    const count = this.entries.size + added;
    if (count > VARIABLE_LIMITS.count || bytes > VARIABLE_LIMITS.snapshotBytes) throw new Error("Live variable count or snapshot byte limit exceeded");
    const values = Object.assign(Object.create(null), this.values);
    if (this.generation >= 9223372036854775807n) throw new Error("Live variable generation exhausted");
    const generation = this.generation + 1n;
    const now = performance.now();
    if (!this.dirty.size) this.redisCoverage = now;
    if (this.generation === this.sqlGeneration) this.sqlCoverage = now;
    for (const [key, entry] of staged) {
      values[key] = entry.value;
      this.entries.set(key, entry);
      this.sizes.set(key, stagedSizes.get(key)!);
      this.dirty.set(key, generation);
    }
    this.bytes = bytes;
    this.generation = generation;
    this.values = Object.freeze(values);
  }

  beginEvent(event: string): void { this.assertAdmission(); this.event = event; this.eventStarted = performance.now(); }
  quiesce(): void {
    if (this.eventStarted !== undefined) throw new Error("Live variable stop incomplete: source event has not settled");
    this.lifecycle = "quiescing";
  }
  settle(outcome: SettledVariables["source"]["outcome"]): void {
    // Never capture a half-executed source event from a dispatcher timer.
    this.settled = { generation: this.generation, entries: Object.freeze([...this.entries.values()]), capturedAt: performance.now(), source: { event: this.event, outcome } };
    this.eventStarted = undefined;
  }
  acknowledge(captured: SettledVariables): void {
    if (captured.generation < this.redisGeneration) return;
    this.redisGeneration = captured.generation;
    this.redisCoverage = captured.capturedAt;
    for (const entry of captured.entries) {
      const dirtyGeneration = this.dirty.get(entry.key);
      if (dirtyGeneration !== undefined && dirtyGeneration <= captured.generation && this.values[entry.key] === entry.value) this.dirty.delete(entry.key);
    }
  }
  acknowledgeSQL(generation: bigint, capturedAt: number): void {
    if (generation > this.sqlGeneration && generation <= this.redisGeneration) {
      this.sqlGeneration = generation;
      this.sqlCoverage = capturedAt;
    }
  }
  get metadata() {
    return { localGeneration: this.generation.toString(), redisAcceptedGeneration: this.redisGeneration.toString(), sqlCheckpointGeneration: this.sqlGeneration.toString(), dirtyKeys: this.dirty.size, entriesBudgetBytes: this.bytes, noops: this.noops,
      redisCoverageAgeMs: this.dirty.size ? performance.now() - this.redisCoverage : 0,
      sqlCoverageAgeMs: this.generation > this.sqlGeneration ? performance.now() - this.sqlCoverage : 0, lifecycle: this.lifecycle };
  }
}
