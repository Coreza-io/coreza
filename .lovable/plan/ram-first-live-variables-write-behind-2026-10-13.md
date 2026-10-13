## SUPERCEDING DESIGN UPDATE — coalesced dirty-variable write-behind (2026-10-13)

**This section supersedes all per-tick event enqueue, per-mutation Redis Stream append, per-update receipt and unbounded ordered-event journal suggestions below for REPLACEABLE workflow variable state.** Treat this design as the authoritative default. Older sections remain as background for reliability evaluation only; implement according to this update when conflicts arise.

### Core rule

**Live ticks never enqueue a Redis/BullMQ job per variable change or tick.** A typed Persistent Edit Fields invocation validates all fields and synchronously publishes an immutable RAM snapshot; dirty variables are captured in a **bounded, coalescing per-workflow accumulator**. One async flush dispatcher per live strategy periodically publishes a compact latest-state checkpoint to Redis, and a separate checkpoint worker publishes the latest committed version to PostgreSQL. `$vars` reads and RAM writes remain local and network-free; the next stream tick always sees the most recent local value. Backtests retain ephemeral overlays, previews never write, and manual/cluster may retain the existing awaited SQL commit path initially.

### Data model: dirty map rather than queue of ticks

- Keep `currentValues`, `localGeneration` (monotonically increasing), `lastRedisAckGeneration`, `lastSqlCheckpointGeneration`, and a dirty map keyed by variable name, storing latest validated value and last mutation generation. Keys are unique per user+workflow+writer epoch.
- A persistent Edit batch is all-or-nothing in RAM. For changed values, increment generation once per batch, overwrite dirty-map entries by key, and allow downstream execution immediately. Repeated writes of the same scalar skip generation/flush work. Enforce existing key, type, count and snapshot-byte limits.
- Dirty-map memory is bounded by maximum variable count and value size (e.g. existing 128 keys, 4 KB/variable, 64 KB total snapshot), not proportional to number of ticks. New generations supersede old pending values. Do not allocate one Promise, queue item, BullMQ job or Redis event per tick.
- Keep a **single in-flight flush per workflow**, with a separate mutable dirty map for concurrently arriving changes. On flush start, capture an immutable `{epoch,generation,values/changes,baseCheckpoint}` snapshot and send it; new edits continue updating RAM and dirty state. On acknowledgment, clear only the dirty keys whose last-generation is **≤ acknowledged generation and whose value is unchanged**; never clear more recent mutations. If newer changes arrived, next flush will include them. A snapshot may include all variables (preferred with bounded 64 KB size) to make coalescing/recovery easy; verify write amplification in benchmarks.
- Strict version fencing is essential: older delayed batches must not replace newer Redis or SQL checkpoints. Require monotonic (epoch, generation) CAS; use atomic Redis Lua/transaction or ordered single-writer fencing. SQL checkpoint uses conditional version UPSERT under scoped lock. Never rely on wall-clock timestamps for ordering.
- Coalesce only **replaceable current-state variables**. Never coalesce position fills, order commands, audit events, once-only side effects, or event histories. Their durable event log/order safety path remains separate.

### Two asynchronous flush cadences, not per-tick jobs

1. **RAM → Redis:** default proposed benchmark candidate 250 ms (tunable initial range 100–500 ms); one dispatcher per active live workflow; wake only when dirty, avoid overlapping flush, and batch all changed variables. Redis operation is non-blocking to live ticks; Redis acknowledgment establishes Redis-received watermark (NOT necessarily disk durable).
2. **Redis → PostgreSQL:** checkpoint worker batches latest state every proposed 2 seconds (tunable initial range 1–5 seconds) OR at configurable dirty-size/age thresholds. Avoid triggering one SQL transaction per Redis update. Use at most one outstanding checkpoint transaction per workflow; coalesce intervening Redis snapshots and check version monotonicity.
3. Intervals above are **hypotheses**, not measured guarantees; instrument throughput, event-loop lag, p95/p99 tick latency, oldest dirty age and recovery lag under realistic market stream load and Redis/SQL failure injection. Adaptive frequency or max-dirty-age flush may be added if tests justify it. Don't promise a flush always completes within the selected interval when backend is slow.

### Transport, recovery and downtime

- For this latest-value design, a **versioned full-state Redis checkpoint** can be more efficient than a stream of every mutation. Use a non-evictable persistence-capable Redis topology and an atomic versioned update + checkpoint notification/dirty-index mechanism for the SQL worker. If using Redis Streams, send **one coalesced snapshot per flush**, not one event per tick; it must still be bounded/retained and not rely on a cache-evictable Redis instance. Choose one approach after evaluating deployed Redis config and recovery semantics.
- Checkpoint worker must recover missed notifications by enumerating dirty workflows/versioned Redis checkpoints, not relying solely on lossy Pub/Sub. Acknowledge SQL progress by workflow generation and reconcile on restart. Redis may be ahead of PostgreSQL; startup should read both and recover newest coherent checkpoint, rejecting missing/inconsistent epoch state.
- **Race rule:** completion for Redis generation 20 must not remove dirty entries changed at generation 21. Completion for SQL generation 20 must not mark generation 21 durable. A slow generation-20 flush must not overwrite Redis generation 21.
- **Loss window:** a process crash before Redis receives the latest coalesced snapshot can lose up to the unflushed dirty window; Redis crash before its own persistence can lose more. This is an explicitly approved tradeoff for noncritical runtime state. Never claim zero-data-loss or exactly-once write-ahead durability from RAM-first design.
- **Backpressure:** dirty state is bounded by key count, but the number of workflow dispatchers, failed I/O tasks and worker checkpoint backlog also need explicit global caps, max-age budgets, exponential retries and circuit breakers. If pending state stays unpersisted too long, mark degraded/stop strategy according to documented safety policy. No silent infinite retries.
- **Graceful stop:** stop new tick intake, flush latest dirty snapshot to Redis and (if required by SLA) wait for PostgreSQL checkpoint watermark, with bounded timeout and explicit unflushed status.
- **High-frequency performance:** avoid JSON stringify or full-map cloning on EVERY tick; use cheap equality tests for existing scalar values and copy-on-write only for changed batches. Build serialized checkpoint payloads inside dispatcher, not per read. Confirm event-loop/cpu/heap overhead in benchmark.
- **Multi-worker:** owner+workflow single live writer with fencing lease; if multiple live workers become necessary, design a separate consistent aggregation protocol before permitting concurrent RAM-first updates.

### Implementation changes to existing phases

**Replace prior Phase 1** with a `LiveVariableState` manager: validated in-memory mutation; dirty map + generation; immutable expression-visible snapshot; bounded per-workflow state; operation metrics; no IO on mutation.

**Replace prior Phase 2** with one lightweight scheduled, event-loop-friendly async coalescing dispatcher per workflow. Timer/wake loop only, no per-tick queue job. Atomic version-fenced Redis flush, single in-flight, generation-safe dirty clearing, retry/backoff. Proposed 250-ms default only after benchmark.

**Replace prior Phase 3** with a worker that reads the latest versioned Redis checkpoint/dirty-workflow index, batches to PostgreSQL at a slower configurable interval, performs monotonic SQL writes, and acknowledges checkpoint generation. A coalesced snapshot may skip intermediate states by design.

**Update prior Phase 4** so schema has compact latest-state checkpoint, writer epoch/generation, and bounded metadata. Do not accumulate an ever-growing receipt JSONB or per-tick SQL log. Keep old scoped variables and migration compatibility; ensure rollback/restart chooses latest recoverable version.

**Update prior Phase 5** to keep the flag `LIVE_VARIABLE_WRITE_BEHIND_ENABLED` disabled by default and restrict to live execution. No UI or parser changes. Manual/cluster remain existing durable path unless separately designed.

**Update prior Phase 6** with load tests that intentionally generate >10,000 stream ticks/sec in a controlled synthetic fixture and show bounded dirty map size, no per-tick queue jobs, and a configured upper bound on Redis/SQL write RATE; do not assert such throughput as achieved. Verify duplicate/no-op, crashes, restart, slow Redis, SQL downtime, out-of-order completions, stop/drain and trading safety.

### New acceptance tests — mandatory

1. 10,000 tick updates to ONE variable before first flush leave ONE dirty key, not 10,000 queued operations. Next tick reads latest value.
2. 100 distinct dirty variables still fit bounded state and flush together; SQL checkpoint work scales with flush batches, not tick count.
3. Mutation of key A at generation 21 during in-flight generation-20 flush survives the generation-20 ACK and persists later.
4. Delayed Redis generation 20 cannot overwrite generation 21; delayed SQL generation 20 cannot overwrite 21.
5. Redis down for multiple intervals: RAM continues only within bounded policy; degraded/stop threshold fires deterministically and no unbounded timer/promise accumulation.
6. PostgreSQL slower than incoming Redis snapshots: SQL worker checkpoints latest coherent version without creating unbounded SQL tasks; bounded and monitored checkpoint lag.
7. Crash recovery chooses latest valid Redis checkpoint over older SQL and handles Redis-loss policy; missing/old epoch fails closed.
8. Unchanged assignments cause zero dirty updates, Redis sends or SQL writes. `false`, `0`, empty strings and negative numbers remain intact.
9. Graceful stop flushes or returns explicit unflushed status; cancellation during active flush cannot mark a newer generation durable.
10. Manual execution, backtests, previews and existing features remain unchanged and have no surprise async write behavior.
11. Synthetic high-frequency input validates P95/P99 tick latency, CPU, memory growth and Redis/SQL operation counts. Acceptance thresholds must be set from measured baseline.
12. Trade-critical state never silently depends on coalesced, unacknowledged variables for crash recovery.

**Decision to record before implementation:** initial flush cadences, Redis transport (versioned checkpoint vs coalesced Stream), lease/fencing mechanism, loss window, Redis durability configuration, SQL checkpoint maximum delay, shutdown timeout, and explicit list of replaceable versus trade-critical variables.

---

# Coreza RAM-first live variables with asynchronous Redis → PostgreSQL write-behind

Status: DESIGN / IMPLEMENTATION PLAN ONLY. No application code modifications.
Target: Coreza-io/coreza, branch `dev`.
Objective: preserve mutable workflow variables across EVERY live stream tick in the same live worker without synchronous SQL/Redis I/O on the node hot path. A separate persistence worker records ordered updates in Redis and checkpoints them to PostgreSQL asynchronously. Build on current Edit Fields Persistent, workflow-scoped `$vars`, expression, Redis and Supabase infrastructure, with minimal changes.

## A. User contract and intended semantics

- Edit Fields → Persistent ON remains the only variable authoring/updating UI. Existing typed fieldName/dataType/value fields remain unchanged; variable retrieval remains `{{ $vars.bonus }}` in any expression field. No separate Settings Variables UI and no Get Variable node.
- Persistent ON in **live mode**: evaluate and validate all rows together, then atomically replace the local in-memory variable snapshot synchronously (copy-on-write). Later nodes in the SAME stream event and ALL subsequent stream ticks handled by that worker read the new values directly from RAM. `resetForNextBar(true)` MUST NOT reset them. An unchanged value is a no-op.
- Persistent OFF: ordinary Edit Fields output; no live variable registry changes.
- Local mutation success is distinct from durable persistence success. Node success can mean accepted into RAM with a pending-durability state, not guaranteed in PostgreSQL. Do not claim it is durable until the checkpoint worker confirms it.
- Scope: (authenticated user, workflow ID, live strategy instance/epoch) plus a monotonically increasing update sequence. Decide explicit single-writer lease/ownership before allowing mutations. No process-global $vars.
- On live worker startup/restart: restore the newest **valid authoritative checkpoint + ordered durable Redis log/snapshot**, validate owner/workflow/epoch/revisions, then start processing ticks. A fresh execution must not silently load a stale Postgres value when newer Redis events exist.
- Writes must not cross workflows or users. No implicit cross-worker hot propagation; enforce one active writer per workflow epoch or explicit fencing tokens.
- Backtest: ephemeral per-session overlay, absolutely no production write-behind; preview read-only. Manual and cluster Execute: retain the CURRENT awaited SQL commit implementation initially, until a separately reviewed safe handoff exists. Avoid changing unrelated execution modes.
- Trade-critical fields (order/position state, capital checks, risk limit enforcement) must NOT use an unacknowledged RAM-only update as an authoritative recovery source. Add configurable durable acknowledgment / fail-closed boundaries, or keep the old synchronous path for those writes. Explicitly document crash-loss tradeoff.

## B. Current code baselines to reuse (revalidate HEAD before coding)

- `coreza-backend/src/engine/workflowRun.ts`: `initialize`, runner-local `variables`, `commitVariables` currently waits for `VariableSnapshotService.commit` before publishing immutable snapshot. Replace only LIVE mutation behavior behind a flag; preserve manual/backtest flow.
- `coreza-backend/src/engine/executionRuntime.ts`: `commitVariables` execution context, idempotency token, `getVariables` and refresh for subsequent node context. Keep synchronous memory read semantics; ensure proper invocation sequencing.
- `coreza-backend/src/nodes/executors/ControlFlowExecutor.ts`: `stagePersistentFields` first, then await commit. Keep stage/validation; route live through synchronous memory update and a cheap bounded enqueue, preserving typed output.
- `coreza-backend/src/nodes/logic/editFields.ts` + `coreza-backend/src/variables/contract.ts`: validate types/names/whole batch and use immutable `overlayVariables`; preserve scalar limits, zero/false/empty values, and missing-key diagnostics.
- `coreza-backend/src/services/WorkflowRunner.ts`: long-running tick loop / Redis Stream consumption, `resetForNextBar(true)`, initialization before consumer group reclamation, stream IDs and ack. Tie persistence barrier to stop/drain and recovery.
- `coreza-backend/src/variables/VariableSnapshotService.ts` + `VariableRepository.ts`: current SQL revision-based snapshots and cache; extend with recoverable snapshot/log checkpoint metadata; do not eliminate existing read-only cache and owner validation.
- `coreza-backend/src/config/redis.ts` / `infra/redisKeys.ts`: separate cache vs queue connections. Investigate current Redis persistence settings and BullMQ clients before selecting reliable handoff.
- `supabase/migrations/20261012100000_edit_field_workflow_variables.sql`: existing workflow columns, owner-global revision lock and unbounded `commit_receipts` JSONB. Prevent write-behind from multiplying this data; propose bounded journal/checkpoint schema.
- `coreza-backend/docs/workflow-variables.md`: document new LIVE-only semantics and migration.
- Existing tests `persistentWorkflowVariables.test.ts`, `persistentVariableRunner.test.ts`, `persistentVariableExecution.test.ts`, SQL integration suite: extend not replace.

## C. Architecture and durability: separate hot path from persistence

### Hot path, synchronous
1. Edit Fields stages and validates full batch.
2. Assign a per-workflow, per-epoch monotonically increasing `seq` and deterministic update ID = (owner, workflow, epoch, seq, node/invocation, source event ID). Use a single-writer lease/fencing token.
3. Apply the batch atomically to the in-process local snapshot and record it in a **bounded local pending-update buffer**. If buffer cannot accept update under the chosen policy, reject before publishing state or enter explicitly configured degraded mode. No unbounded JS queue.
4. Publish snapshot to downstream nodes; continue stream tick. No synchronous PostgreSQL call and no requirement to wait for Redis acknowledgment on normal (noncritical) updates.
5. A separate async I/O dispatcher drains buffered updates into durable Redis transport; a distinct worker persists confirmed stream updates into PostgreSQL.

### Redis transport
- Use Redis **Streams** (or existing durable BullMQ jobs with equivalent per-workflow ordering/idempotency), not just Redis Pub/Sub, ephemeral cache SET, or a naive non-acknowledged in-memory event emitter. A simple Redis cache key update is NOT equivalent to durable enqueue.
- Keep variable persistence stream namespace separate from market-data Streams, cache keys, and BullMQ queue keys.
- One ordered logical stream per workflow/epoch, or equivalent partitioned queue with exactly one ordered consumer per workflow and fencing. XADD receipt means Redis accepted the event, but persistence durability still depends on Redis AOF/replication configuration. State assumptions explicitly.
- Track three watermarks: `localSeq`, `redisAcknowledgedSeq`, `postgresCommittedSeq`. Do not assume equality while asynchronous.
- For continuous frequent updates, bounded batching/coalescing may replace intermediate values only where permitted. Preserve required event ordering and replay/checkpoint correctness. Coalesce snapshots by variable key for latest-value persistence, but never drop events needed for audit or idempotency; classify variables accordingly.
- Async worker commits monotonic sequence updates to SQL via conditional UPSERT / single scoped transaction. Ignore duplicate/replayed events and reject older seq/epoch writes. Only acknowledge Redis stream entries after SQL checkpoint commits.
- Checkpoint scope should be per workflow, not one user-global revision bottleneck. Use properly indexed bounded checkpoint rows and separate bounded/retained idempotency journal, not unbounded JSONB `commit_receipts`.
- Worker-lease expiration/reassignment must fence stale writers. A second live worker must not roll variables backward.

### Crash / flush behavior
- **Crash before Redis accepts update:** RAM-only changes may be lost. This is inherent in the requested zero-wait design. Explicitly define an acceptable loss window and expose pending durability in metrics/status.
- **Crash after Redis accepted but before PostgreSQL:** replay Redis log on recovery and restore latest consistent values.
- **Crash after SQL commit but before Redis XACK:** idempotent SQL mutation and retry-safe reack.
- **Redis outage:** buffer within strict cap for a bounded interval; once exceeded, stop/skip variable updates and fail safely (do not keep silently trading using state that cannot be recovered). Critical strategy state always fail-closed.
- **Graceful stop:** stop accepting new ticks, drain local dispatcher, wait for acknowledged Redis + SQL checkpoint up to explicit timeout, report unsaved updates on timeout. Never claim successful flush without watermarks matching.
- **Cold start:** retrieve PostgreSQL checkpoint and Redis durable updates; detect gaps, missing epochs, retention trimming, stale fencing and revisions. If sequence gap or Redis lost pending data, fail startup or follow explicit operator-approved loss policy. Do not blindly start with stale state.
- **Redis eviction/persistence:** use an appropriate non-evictable Redis instance/policy for durability-sensitive Streams; cache Redis configured for eviction is NOT a durable source. Evaluate whether existing queue Redis topology and persistence policies are suitable, else introduce isolated logical connection/config only when necessary.
- **PostgreSQL outage:** Redis backlog grows only within bounded retention; pause/stop live if backlog exceeds limits; resume checkpoint safely.

## D. Engineering implementation phases

### Phase 0: baseline and design decision
Trace live worker ownership, Stream event ordering, Redis endpoints/config/AOF, feature flags, current SQL revisions/receipt growth, manual/cluster and backtest paths. Produce loss-window policy, overflow behavior, flush SLA, restart contract, critical-variable policy and measured baseline. No speculative code rewrite.

### Phase 1: local variable state manager
Create minimal per-runner `LiveVariableState` abstraction around existing snapshot rather than replacing parser: immutable copy-on-write values, seq, epoch, bounded pending buffer, watermark visibility, idempotent node-event IDs, lifecycle `start/stop/reset`. Preserve typed and generic `$vars` in-memory reads; no network in expression evaluator.

### Phase 2: write-behind dispatcher
Reuse existing Redis infrastructure, add one lightweight ordered async dispatcher per runner (not one Promise per node per tick). Bound queue by bytes/events, batch sends, expose backpressure, timeouts and retry with jitter. Distinguish acceptance into local buffer from confirmed Redis acknowledgment. Do NOT drop newest unpersisted state silently. Instrument age and pending bytes.

### Phase 3: dedicated persistence worker
Reuse existing worker deployment/BullMQ framework where appropriate. Build single ordered consumer per workflow+epoch with fence checks and transactional monotonic checkpoint. Implement idempotent replay, redelivery, dead-letter handling, PostgreSQL outage recovery, and bounded retention safe relative to checkpoint watermark.

### Phase 4: recovery and schema
Add minimal migration for workflow-scoped checkpoint state, watermark/epoch, writer fence and bounded receipt/log metadata. Keep legacy SQL variables readable, existing global data isolated, and old Redis keys untouched until a deliberate migration. Backfill checkpoint from authoritative SQL at feature enablement; flip only when Redis recovery contract is verified. Avoid user-global revision contention.

### Phase 5: live-only wiring
Gate by new disabled-by-default `LIVE_VARIABLE_WRITE_BEHIND_ENABLED`. In `WorkflowRun.commitVariables`, use local state update + bounded handoff in LIVE mode; retain current synchronous SQL for manual/cluster and backtest ephemeral overlay. Runtime publishes snapshot before downstream execution; current `$vars` syntax unchanged. Stream runner stop/recovery uses watermark barriers. Never write during preview.

### Phase 6: tests and rollout
Unit + integration + chaos + load tests; deployed Redis/SQL lifecycle validation. Enable for noncritical test strategies first, then allow controlled rollout with rollback to synchronous mode only after backlog is drained and checkpoint verified. Preserve old behavior when flag is off.

## E. Explicit acceptance scenarios

1. Tick 1 Edit sets `bonus=10`; following node reads 10 synchronously even when Redis/SQL latency is injected. Tick 2 reads 10, updates 20; Tick 3 reads 20. `resetForNextBar(true)` never erases 20.
2. 10,000 `$vars` reads and 10,000 stream ticks: no SQL/Redis read calls on expression hot path; check event-loop lag and p50/p95/p99 node latency.
3. 10,000 unchanged Edit writes: no new persistence events. Changed updates enqueue bounded messages without waiting on remote I/O.
4. A batch with one invalid field: no RAM publication and no persistence event. `0`, `false`, negative numbers and empty strings preserve type.
5. Redis is 2 seconds slow; live tick continues within bounded local buffer, then configured backpressure triggers predictably.
6. Crash before enqueue: documented allowable loss only, never claim committed state. Crash after Redis XADD: recovered value is applied. SQL commit before XACK: replay is idempotent.
7. Stop during pending updates: wait for flush within timeout or return explicit pending/unflushed status; never falsely mark fully persisted.
8. Out-of-order dispatcher delivery, consumer replay and two competing workers never decrease persisted seq or overwrite newer epoch.
9. Restore from SQL checkpoint plus latest Redis log after restart; detect missing sequence gaps and fail closed.
10. PostgreSQL down while Redis works: bounded backlog, retry, alert and recovery. Redis down: bounded local buffer with deterministic stop/degradation.
11. Backtest uses ephemeral state only; preview performs no writes; manual/cluster behavior unchanged; legacy workflows unaffected.
12. Cross-user and cross-workflow isolation in Redis Streams, SQL RLS/RPC, worker memory and expression preview.
13. Persistence worker crash/rebalance, duplicate delivery, BullMQ retry, and stream redelivery preserve ordering.
14. Exactly one active writer/fence; stale worker after failover cannot checkpoint or trade with conflicting state.
15. Staged rollout tests current and new modes; rollback drains backlog and does not load stale SQL while newer Redis updates exist.
16. Database storage remains bounded through checkpoint/event retention. Resource metrics use no raw variable values or user identifiers.

## F. Observability and operational criteria
Track `local_seq`, `redis_ack_seq`, `postgres_commit_seq`, backlog events/bytes, oldest-unpersisted age, Redis append latency, Postgres batch latency, flush success/timeout, recovery replay count, stale-fence errors, duplicate suppression, dropped/lost-window warnings, live-tick p99 and event loop lag. Avoid unbounded-cardinality labels or logging values. Alert when checkpoint lag or buffer growth crosses configured thresholds.

## G. Safety/accuracy constraints
- RAM-first + zero remote I/O wait **cannot guarantee zero data loss**; explicitly expose loss window and configurable critical write barrier.
- Redis Stream XADD acknowledgement does NOT inherently guarantee disk persistence or replica quorum; document AOF/WAIT or other durability mechanics. Enabling those guarantees in hot path increases latency.
- Backpressure, queue acceptance and worker fencing need real operations and explicit error states, not unawaited promises. A bounded enqueue into local memory can be synchronous; **durable** enqueue is asynchronous remote I/O.
- Don't equate n8n workflow static data with Coreza stream state: n8n saves changes on completed executions, not this Redis write-behind architecture.
- Do not expand feature into global variable settings, unrelated cluster editors, node naming or trading engine redesign.
- Require observable on-disk recovery, multi-process concurrency tests, staging deployment and per-trade safety reviews before production use.

## H. Deliverables and approval gate
- Focused list of files changed and migration/rollback.
- Before/after sequence diagrams for live tick, async writer and crash recovery.
- Red/green tests proving no synchronous I/O on live Edit mutation path, and correct replay/restart semantics.
- Durability matrix (RAM-only, Redis-received, Redis durable, PostgreSQL checkpointed) and risk policy.
- Measured p95/p99 latency and lag with market-stream load.
- Explicit sign-off on loss window, backpressure and critical-trading-variable categories.
Only then mark ready. Do not merge to main or modify runtime until this plan is approved.
