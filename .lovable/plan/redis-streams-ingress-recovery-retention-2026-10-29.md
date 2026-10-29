# Coreza — Redis Streams ingress, acknowledgment, recovery and retention hardening
Date: 2026-10-29
Target branch: dev
Status: PLAN ONLY — no runtime code changes
Scope: Live market-data gateway → subscriber → workflow strategy streams → WorkflowRunner; protect trading side effects. Preserve existing Redis/BullMQ/PostgreSQL architecture. Do not introduce Kafka.

## Objective and non-goals
Close the verified correctness gaps in the Redis producer-consumer pipeline while keeping sequential low-latency live execution. Distinguish **market data** (often freshness-oriented, possibly lossy under explicit policy) from **broker/order/fill lifecycle events** (recovery-sensitive). Do not promise every-tick delivery across broker disconnections or Pub/Sub outages without a durable upstream ingestion redesign.

Not in scope: Kafka migration, rewrite of execution engine, automatic replay of already-effecting trade commands, or replacing the existing live-variable checkpoint subsystem. No blanket unbounded stream retention.

## Verified baseline (dev source)
1. `market-stream-service/src/services/MarketDataGateway.ts`: normalized broker events are sent through Redis Pub/Sub (`publishToRedis`) before workflow-specific stream persistence. Pub/Sub has no replay on disconnection.
2. `market-stream-service/src/services/MarketDataSubscriber.ts`: per-workflow/per-ordering-domain in-process Promise delivery chain; `appendToWorkflowStream` uses `getRedisCache().xadd(streamKey, "MAXLEN", "~", "1000", "*", "event", payload)`; Redis Pub/Sub also delivers frontend messages. In-process queue is unbounded and not restart-durable.
3. `src/services/WorkflowRunner.ts`: `strategy-group` via `XGROUP CREATE ... 0 MKSTREAM`; `XREADGROUP ... COUNT 10 ... >` sequentially handles entries. `XAUTOCLAIM ... 60000 0-0 COUNT 10` runs once at startup, does not paginate or revisit pending work. `XACK` occurs after execution/outcome recording or after invalid/missing payload classification, but errors are logged/swallowed.
4. Runner returns without ACK if creating a run fails, then may continue onto newer messages. It records execution errors and ACKs despite unsuccessful business processing. Pending/ACK failure after side effects creates replay ambiguity.
5. Topology mismatch: subscriber writes to cache Redis while backend `createDedicatedStreamConnection` reads queue Redis. If URLs/databases/Sentinel masters differ, streams diverge. Deployment settings not inspected.
6. Prior audit `.lovable/plan/live-execution-performance-and-recovery-review-dev-2026-10-18.md` documents adjacent live-variable snapshot and trade-replay constraints. Treat it as design context, not substitute for deployment verification.

## Delivery semantics and policy decisions (required before implementation)
- Define an event classification contract: quote/tick, bar/closed bar, order update/fill, control. Select independently for each: at-most-once/coalesced vs at-least-once and retention period/backlog budget. Trading lifecycle events must not be silently dropped.
- Define the acknowledgment boundary: Redis XACK signifies **runner-side disposition**, NOT exactly-once execution, broker acceptance or durable end-to-end checkpoint. A failed workflow can be an intentional terminal disposition and must remain inspectable.
- Explicitly decide recovery policy for potentially effecting broker actions: stop/quarantine and reconcile with broker and order ledger before retry. Never auto-replay ambiguous trade execution just because the Redis PEL contains an entry.
- Per-event sequencing belongs to a workflow + ordering domain; cross-domain/global total order is not currently guaranteed.
- Document source outage/Redis Pub/Sub loss as a separate gap. Do not claim Redis Stream replay covers an event never appended to the stream.

## Phase 0 — topology and observability (P0)
- Audit producer/consumer/cleanup/admin Redis configurations, env vars, Redis DB index, Sentinel/cluster mode, deployments, ownership. Choose **one** shared strategy-stream Redis topology, preferably durable queue Redis, preserving separate cache usage for cache keys.
- Migration plan: enumerate keys/consumer groups/pending IDs on both old and new topology; stop or quiesce relevant workflows, reconcile and migrate retained events without double processing; fence old writers and consumers; rollback and restart policy. No silent switch that strands pending input.
- Fail startup or activation with a clear error if producer/consumer topology identity cannot be validated; avoid using credentials in logs.
- Add counters/gauges/histograms: gateway received; Pub/Sub publish; routed event; XADD accepted/failed; XREADGROUP processed; ACK success/failure; PEL count/oldest idle; stream length/age; gateway→XADD, XADD→start, start→ACK lag; ingestion Promise queue count/bytes; trimmed/overflow/recovery quarantined; per event class and workflow (cardinality bounded).
- Measure baseline under representative provider traffic before choosing thresholds.

## Phase 1 — retention and ingress backpressure (P0)
- Remove unconditional `MAXLEN ~ 1000` from recovery-sensitive workflow streams. Implement a bounded consumer-aware retention design: track group-safe minimum processed/acknowledged cursor and avoid trimming pending or undelivered entries. Inspect `XINFO GROUPS`/`XPENDING` and Redis version semantics; deletion by ID only once all relevant consumers no longer require entries.
- Account for un-delivered messages as well as PEL entries: 'not pending' does not mean 'safe to trim'. Use a safe acknowledged watermark and explicit single-consumer-group policy (or a minimum watermark across groups).
- Set per-class retention and memory/backlog limits grounded in measured tick rates, processing throughput and maximum planned outage. When limits are exceeded, emit visible overload state, gate/stop affected workflow, or apply **explicitly approved** quote/tick coalescing only; do not silently discard fills/orders.
- Bound `MarketDataSubscriber.deliveryQueues` by events and bytes. Backpressure/drop/coalesce only according to class policy. Preserve ordering and never block the Redis event loop indefinitely; fail closed if critical backlog exceeds safe bound.
- Recognize pre-XADD Pub/Sub loss window. For stronger delivery, separately consider direct durable ingress before Pub/Sub or provider supported replay, but do not include a broad gateway rewrite in initial phase.

## Phase 2 — pending recovery and sequencing (P0/P1)
- Build a recovery state machine: NEW → RECEIVED → EXECUTING → TERMINAL/ACKED or PENDING_RECONCILIATION. Recover pending pages with cursor-aware `XAUTOCLAIM` and handle `deletedIds`, empty page, idle thresholds, transient connection failures and interrupted scans.
- Avoid simply adding periodic unconditional reclaim. Separate **safe pre-execution** pending events from **ambiguous post-side-effect** events; quarantine latter until broker/order-ledger reconciliation. Use run ID, event stream ID, workflow generation/fencing token and durable intent/receipt when supported.
- Ensure a pre-execution persistence/admission failure prevents later inputs from overtaking an unresolved older event in the same required ordering domain. Explicitly pause or retry with backoff; resume only once cleared.
- ACK failure is not success. Record and expose unresolved ACK, retry idempotently while preserving proper order, and reconcile side effects before re-execution. Malformed input should go to an observable DLQ/terminal record before ACK when feasible.
- Protect from multiple simultaneously active runners processing same workflow/generation using ownership fencing; verify lifecycle on stop/restart. Don't infer 'exactly once' from consumer groups.

## Phase 3 — execution checkpoint boundaries (separate design gate)
- Preserve current eligible RAM-first `$vars` versioned checkpoint, ownership, worker policy and existing feature flags; a variable snapshot is NOT a full engine checkpoint.
- Do not tie strategy-stream XACK directly to a scalar-variable SQL checkpoint. Indicator/consolidator/window/portfolio/external-result state and broker side effects must be considered for full replay safety.
- If product requirements demand automatic deterministic replay, propose separate durable execution intents, full state checkpointing, idempotency and reconciliation before changing ACK contracts. Otherwise retain explicit operator recovery for ambiguous events.

## Phase 4 — performance and rollout
- Deploy incrementally behind feature gates per workflow/event class. Start with metrics and topology validation; then retention/overload; then recovery state machine. No single big-bang migration.
- Benchmark peak/steady market load, burst, slow executor, disconnections, Redis restart/failover, overlapping runners, producer crash before/after XADD, consumer crash before/after broker request and before/after XACK.
- Success metrics: no silent loss of protected events in declared retention envelope; no duplicate broker orders on replay; bounded RAM/stream growth; ordered processing where declared; successful PEL scan and visible quarantine; p50/p95/p99 ingress and execution latency no regression beyond agreed budget.
- Test Redis cache and queue **different** plus **same** topologies. Validate migrated pending entries and rollback. Exercise unexpected missing/trimmed entries and alerts.
- Rollback: stop activation, fence workers, retain streams and pending state, restore previous reader path only after cursor reconciliation; never delete pending messages to get healthy metrics.

## Implementation touchpoints
- `coreza-backend/market-stream-service/src/services/MarketDataGateway.ts`
- `coreza-backend/market-stream-service/src/services/MarketDataSubscriber.ts`
- `coreza-backend/market-stream-service/src/config/redis.ts`
- `coreza-backend/src/config/redis.ts`
- `coreza-backend/src/services/WorkflowRunner.ts`
- `coreza-backend/src/infra/redisKeys.ts`
- workflow activation/runner ownership and order/fill ledger paths (inspect before editing).
- Add focused unit, integration and fault-injection tests (including crash/restart and overload). No code/tests executed as part of writing this plan.

## Explicit acceptance checklist
- [ ] Shared stream topology documented, validated and migration-safe.
- [ ] Event-class delivery and drop/coalesce semantics approved.
- [ ] Protected stream entries cannot be trimmed while pending or not yet delivered within supported retention envelope.
- [ ] Bounded ingress with observable overload and fail-closed for critical events.
- [ ] Recovery scans entire eligible PEL; doesn't blindly repeat possibly effecting trades.
- [ ] ACK error, deleted stream entry, and invalid data have visible disposition.
- [ ] No later event overtakes unresolved earlier event in guaranteed ordering domain.
- [ ] Tests validate crash windows and duplicate-order prevention.
- [ ] Latency/memory/retention baselines measured and rollout/rollback documented.

## Priority and dependencies
P0: topology alignment, event semantics, safe retention/overload, no duplicate-trade replay.
P1: complete recovery/pagination, sequencing, ACK/DLQ visibility.
P2: latency tuning, provider ingress redesign only if required by explicit durability SLA.

**Plan only: implement only after confirming deployment topology, critical-event semantics and recovery policy.**
