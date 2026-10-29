# Coreza — Live per-tick latency measurement and optimization
Date: 2026-10-29
Target: dev
Status: PLAN ONLY — no runtime changes
Audited source: bb1fb6038f46d6ebac69431dd43846c7853d295f
Repository: Coreza-io/coreza
Review update: clarified indicator write paths/recovery, per-event timing, histogram resolution and existing lifecycle/logging work.

## 1. Goal and scope

Deliver the fastest practical live per-event execution while preserving strategy results, event ordering, cancellation, ownership, order idempotency and recovery boundaries.

Measure independently:
1. Ingress latency: broker event received by Coreza → appended to workflow Redis Stream.
2. Queue delay: stream append → workflow execution starts.
3. Execution time: workflow execution starts → execution finishes.
4. Order submission latency: submission HTTP request starts → submission response/error.

Provider event creation → Coreza receipt is separate feed age, when the provider supplies a trustworthy timestamp. Never label handler processing as provider network latency.

Use a fifth supporting measurement, full runner-cycle time, because processing between workflows determines how quickly the next tick can start. Instrument first, establish a representative baseline, then optimize the largest measured Coreza-controlled costs.

This is a new performance plan based on the source review. The previous ingress/recovery/retention plan is not the implementation scope. No Kafka, replacement engine, new durable event queue or broad storage rewrite is required. Reuse current Redis, metrics and runner architecture.

## 2. Verified source baseline

| Area | Current behavior | Consequence |
| --- | --- | --- |
| MarketDataGateway.handleMessage | Starts Date.now() inside gateway handler; histogram observed after Pub/Sub publish | Excludes provider transit, subscriber routing and workflow XADD; batch handling and logging are mixed into the measurement |
| MarketDataGateway / logging | Console call sites remain, but PR #870 gates application emission behind startup LOG_LEVEL=debug; arguments such as JSON.stringify(event) may still be evaluated | Profile argument construction separately from enabled logging/output; do not claim logs are always emitted |
| MarketDataSubscriber.enqueueWorkflowDelivery | Promise chains per workflow + ordering domain; records enqueueAt | Serial ingress queue exists before the stream; this is distinct from stream backlog |
| MarketDataSubscriber.deliverWorkflowEvent | Awaits WorkflowCache.getWorkflow before XADD | Cache misses can delay stream ingestion |
| WorkflowCache | RAM entries expire after 60 seconds; misses query database | Periodic ingress latency spikes are possible |
| appendToWorkflowStream | One awaited XADD using cache Redis, MAXLEN approximately 1000 | Preserve append ordering; topology and retention correctness remain separate concerns |
| WorkflowRunner | Queue Redis XREADGROUP COUNT 10; handles events sequentially | Consumer batch waiting and previous-event finalization contribute to queue delay |
| WorkflowRunner.executeMessage | Awaits run creation, engine execution, outcome update and ACK | Extra work before/after the engine affects tick throughput |
| redisRunStorage | Pipelined run creation includes serialized nodes/edges per event; outcome update serializes result | Graph serialization is cached by runner, but graph bytes are still transmitted each event |
| workflowRun.runExecution | Builds result and awaits flushIfNeeded in finally | Caller-visible completion includes indicator flush; result/node timings alone omit portions of wall time |
| IndicatorStateManager | setState updates RAM and awaits Redis immediately; setStateSync updates RAM and marks dirty; final flush pipelines dirty keys | Immediate writes inside nodes contribute to node timing; end-of-workflow flush contributes to execution wall time; no dirty keys means no flush network call |
| executionRuntime | Node elapsed/count totals accumulate; live reset does not clear nodeTiming | Returned timing is cumulative, not one event's wall-clock duration |
| BrokerExecutor | TRADE_TIMING covers place_order and close_position with exclusive phases and HTTP sum | Useful existing diagnostics; not a dedicated submission-request histogram |
| credentialCache | L1 30 seconds; L2 300 seconds | Not activation-lifetime credential pinning; expiry introduces lookup/decrypt/load costs |
| BrokerExecutor/orderIdempotency | Awaited intent, ownership and outcome operations | Necessary safety work must be distinguished from optional reporting; updateOrderCache contains sequential reads/writes |
| Engine | Graph/WorkflowRun reused; trigger results preloaded; synchronous executor path supported | Preserve these existing performance advantages |

Source references (relative to repo root):
- coreza-backend/market-stream-service/src/services/{MarketDataGateway,MarketDataSubscriber,WorkflowCache}.ts
- coreza-backend/market-stream-service/src/utils/metrics.ts
- coreza-backend/src/services/WorkflowRunner.ts
- coreza-backend/src/engine/{workflowRun,executionRuntime,workflowEngine,indicatorStateManager}.ts
- coreza-backend/src/utils/{metrics,redisRunStorage,credentialCache,credentialManager,orderIdempotency}.ts
- coreza-backend/src/nodes/executors/BrokerExecutor.ts
- coreza-backend/src/infra/redisOps.ts
- AGENTS.md

These observations do not establish production Redis topology, enabled feature flags, traffic rate or actual milliseconds saved.

### Existing lifecycle and logging work

PR #870 implemented lookup-source/timing diagnostics and a startup application logging gate, not activation-lifetime credentials. The authoritative lifecycle design is [Live-run cache lifetime and manual-run cleanup](../../coreza-backend/docs/live-run-cache-lifetime-plan.md). Reuse that work for credential references, invalidation and stop/drain cleanup instead of introducing a competing activation registry.

Shared credential TTLs describe the reviewed runtime. Once activation-owned references are implemented, fallback-cache expiry must not evict required active references. Stopping one activation releases its own references without invalidating another active user of the credential.

## 3. Measurement contract

### 3.1 Boundaries and attribution

| Field / metric | Start | End / interpretation |
| --- | --- | --- |
| gatewayReceivedAt | WebSocket handler entry, before parse | Coreza receipt, not provider creation |
| feedAgeMs (optional) | Documented provider timestamp | Coreza receipt; omit when timestamp semantics are unsuitable |
| subscriberQueueWaitMs | Subscriber enqueue | Delivery task begins; split awaited workflow lookup separately |
| workflowLookupMs | Workflow lookup begins | Cached/loaded definition available; attach bounded source label |
| xaddRoundTripMs | Immediately before XADD | XADD response; includes transport and server processing |
| ingressMs | gatewayReceivedAt | Estimated Redis append timestamp, with explicit clock-quality contract |
| streamDeliveryMs | Redis append | Consumer batch returned |
| consumerBatchWaitMs | Batch returned | This event's runner processing begins |
| runnerAdmissionMs | Event processing begins | Immediately before reset/preload/engine preparation |
| queueDelayMs | Redis append | Workflow execution start, including earlier batch entries and run admission |
| executionMs | Before reset/preload and executeFromEntries | Engine returns after finally/required flush; excludes run outcome write and ACK |
| nodeWorkMs | Drain of runnable nodes begins | Node drain completes; nested diagnostic, not interchangeable with executionMs |
| indicatorFlushMs | Required indicator flush begins | Flush settles, labelled skipped/success/error |
| resultBuildMs | Result building begins | Result object built |
| outcomeWriteMs | Outcome serialization/write begins | Outcome recording settles |
| ackMs | XACK begins | XACK settles |
| runnerCycleMs | Runner starts processing this event | Finalization/ACK settles or event exits with explicit disposition |
| orderPrepareMs | Broker node entry | Submission HTTP starts |
| orderSubmitHttpMs | Submission request invocation | Submission response/error |
| orderPostResponseMs | Submission response | Broker node completes |
| signalToSubmitMs | Workflow execution start | First submission request starts, for workflows that submit |

All elapsed measurements include awaited time; they are not CPU-time metrics. Order measurements are nested within workflow execution and must not be added to executionMs again. Broker acceptance is not an execution fill. Cached/skipped/rejected orders have no submission HTTP sample; emit an outcome count rather than a fake zero-latency request.

Define execution start once in WorkflowRunner before reset/preload. If engine-only time is useful, expose it as a nested diagnostic, not a changed definition.

Track successful, failed, cancelled and admission-blocked outcomes without omitting slow failures. ACK failure must remain visible even if current runtime handling logs it. Telemetry must not redefine acknowledgment/retry semantics.

### 3.2 Timestamp and clock handling

- Use performance.now() subtraction for durations within a process. Do not subtract raw performance.now() values from different processes.
- Carry a small internal telemetry envelope with gateway receipt epoch timestamp, event correlation identifier and source metadata. Preserve it for bars, aggregated bars and order events through payload formatting; keep it separate from user market-data fields and variable registries.
- Correlate workflow events using existing workflow/activation identity and stream entry ID after XADD. Prefer existing event sequence/domain plus gateway generation for upstream correlation; do not require a Redis INCR or UUID allocation solely for every telemetry observation.
- Redis XADD * IDs contain a server-side millisecond component. It is a useful append-time estimate, not an exact high-resolution timestamp: Redis clock rollback/prior future IDs and client/server clock skew can distort it.
- Use that component for ingress/queue estimates only with a documented clock-health check performed outside the event path. Count invalid/negative/skewed samples separately; do not clamp them silently or treat them as precise.
- Measure XADD round trip separately in the producer process. Producer receipt of the XADD response is not the exact append time and may occur after the consumer starts.
- If the required precision exceeds the clock uncertainty, mark cross-service metrics unavailable/approximate until appropriate server instrumentation is introduced. Do not add TIME, GET, metadata UPDATE or a tracing network request per tick to manufacture precision.
- Aggregated/closed bars require their own event kind: bar close eligibility → emitted bar stream append is useful; first underlying tick → closed-bar append includes the intended interval and must not be compared with raw tick ingress.
- Use additive optional metadata so existing payload references and manual/frontend consumers remain compatible.

### 3.3 Metric names and collection

Proposed primary histograms:
- coreza_live_ingress_seconds
- coreza_live_queue_delay_seconds
- coreza_live_execution_seconds
- coreza_order_submit_http_seconds

Supporting histograms:
- coreza_live_runner_cycle_seconds
- coreza_live_stage_seconds with a fixed stage set
- coreza_order_stage_seconds with a fixed preparation/submission/post-response stage set
- coreza_live_feed_age_seconds when supported and valid

Keep the existing Pub/Sub histogram with its accurate existing boundary; do not silently rename its meaning while retaining the same time series. Existing HTTP request histograms are not substitutes for broker submission measurements.

Use bounded labels such as broker, event kind, stage and outcome. Workflow IDs, run IDs, symbols with unbounded universes, order IDs and stream IDs belong in sampled diagnostic logs, not ordinary metric labels. Do not create a new metric family per workflow.

Suggested classic histogram buckets in seconds:
0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30.
Tune by metric; execution/queue and broker requests need different useful ranges. The current workflow histogram starts at 0.1 seconds (100 ms). Samples of 1, 5, 20 and 90 ms all count below the same first boundary. This does not round observations to 100 ms: sum/count can still provide an overall average. The limitation is the distribution and percentile resolution. Bucket-derived percentiles are estimates.

Version the histogram schema or coordinate bucket changes across instances so dashboards do not combine incompatible bucket layouts. Observe actual per-event durations, not cumulative node averages.

Observe bounded histograms locally; export through existing scrape infrastructure. No awaited telemetry writes. Use a feature gate and measure telemetry-on versus telemetry-off overhead. Keep timestamps as local numbers; avoid allocating tracing spans/large objects at each node.

## 4. Phase A — implement accurate observability first (P0)

1. Add a shared typed timing contract with optional ingress metadata and fixed stage names.
2. Capture gateway receipt before parsing; distinguish multiple events in one provider frame.
3. Preserve timing provenance through normalization, aggregation and subscriber formatting.
4. Observe subscriber RAM queue wait, workflow lookup and XADD round trip. Continue appending immediately; do not introduce a periodic tick drain.
5. Capture consumer batch-return time, then each event's processing start. Compute queue delay at the defined workflow start, not at batch receipt.
6. Wrap existing run creation, reset/preload, engine call, outcome recording and ACK with local timers.
7. Add execution/flush/result-build observations at their true boundaries, including exceptions and cancellation.
8. Keep existing cumulative node timing available; add per-event deltas or separate resettable counters. Name cumulative totals/counts/averages separately from event node totals/invocation counts. A Loop can invoke one node multiple times in a tick: include all those invocations. Reset only timing counters, never indicator/rolling state. Preserve cumulative backtest/reporting contracts. Include failed-node elapsed time too; successful-result routing alone is insufficient for every outcome. Measure surrounding routing/context/reset work through whole-execution wall time.
9. Add request-purpose tagging to BrokerExecutor transport timing: submit, close, enrichment, authentication, other. Support both generic requests and op.execute custom paths; review each broker adapter so no submit request bypasses classification.
10. Keep HTTP sum distinct from exclusive wall time, including concurrent requests. Record per-attempt submissions and failures; never retry a trade simply because timing failed.
11. Add bounded backlog, ingress queue size, throughput and process event-loop delay measurements to explain p99 spikes. They are supporting signals.
12. Document metric definitions, units, sample exclusions and clock-quality limitations next to declarations.

Deliverable: four requested metric distributions plus supporting phase breakdown, without additional per-tick remote dependencies.

## 5. Phase B — low-risk hot-path reductions (P1)

### B1. Logging and serialization
- Reuse PR #870's existing LOG_LEVEL=debug startup gate in both services; do not add a second switch or redefine its silent-mode policy.
- Guard expensive debug argument construction at call sites, or use supported lazy debug events. A gated console method cannot prevent argument evaluation before the call.
- Avoid evaluating expensive payload formatting/JSON serialization when debug is disabled.
- Preserve error propagation, metrics and the existing configured logging policy; sample verbose diagnostics when logging is enabled, without secrets or raw credential payloads.
- Serialize each routed payload once where its contract allows. Reuse the runner's existing serialized graph snapshots.
- Measure log volume, serialization time and event-loop delay before/after. Logger transport can still consume CPU even when asynchronous.

### B2. Active workflow definitions
- Preload and validate the active definition during registration/activation.
- Maintain the activation's immutable graph revision in RAM; normal delivery should not query database because 60 seconds elapsed.
- Refresh/control changes outside tick delivery, with explicit invalidation/version handling, deactivate/stop propagation and ownership checks.
- Do not extend TTL forever without defining update/revocation behavior.
- Treat missing definition on startup as activation failure; treat control-channel failure under the existing lifecycle policy rather than accepting stale authority indefinitely.
- Keep manual/preview cache policy separate. No new database schema is needed for this step.

### B3. Credential availability
- Follow coreza-backend/docs/live-run-cache-lifetime-plan.md for activation ownership, freshness and cleanup. Merged diagnostics do not establish that lifecycle support is implemented.
- Prewarm required credentials at activation, using existing credential APIs.
- Preserve encrypted shared cache handling and user/credential isolation.
- Prefer a bounded activation-scoped RAM reference with explicit invalidation and OAuth refresh handling, or proactive refresh before current TTL expiry if cross-process invalidation cannot yet be guaranteed.
- Inspect credential update/delete/rotation paths and stop/restart cleanup before enabling pinning. Avoid a new remote validity check per order.
- Use single-flight refresh per credential and bound its resource use. Never retain stale revoked credentials merely for speed.
- Preserve existing manual behavior unless separately authorized; do not equate order intent TTL with credential lifetime.

Deliverable: lower ingress/cache-spike cost, with no strategy or broker-output changes.

## 6. Phase C — optimize measured runner bookkeeping (P1/P2)

### C1. Graph bytes and run records
Run creation currently pipelines several commands in one round trip. Do not claim it costs one round trip per command.
- Measure payload bytes and serialization separately from Redis RTT.
- Inspect RunSyncService, history APIs and run readers before changing graph representation.
- Candidate: store one immutable activation graph snapshot and reference its revision from per-event records; let existing sync/read paths resolve it.
- Preserve graph availability for history/recovery and retention. Activation TTL/deletion must not break references. Keep this candidate separate if it requires broad schema/reader changes.
- Until reader compatibility is established, retain current storage format.

### C2. Outcome and ACK
- Measure result materialization, JSON serialization, Redis outcome write and ACK independently.
- Profile optional reporting fields and large node outputs; retain all data required by strategy references and declared history behavior.
- Consider batching/pipelining only independent writes on the same Redis topology. A pipeline reduces RTT but is not an atomic transaction and does not guarantee earlier command success.
- Do not ACK before a required outcome/receipt is safely recorded. An optimization must inspect individual command errors and preserve crash semantics.
- Do not detach essential finalization into unbounded promises. If reporting can safely be deferred, require a bounded recoverable writer and explicit stop/drain behavior first.
- Do not pipeline commands across cache and queue Redis as if they were one server.
- Verify producer/consumer topology during setup; do not silently migrate streams as part of performance work.

### C3. Indicator state: distinguish calculation from persistence

Verified paths:
1. getState checks L1 RAM before optionally reading Redis.
2. setState updates L1 and awaits an immediate Redis SET. If invoked inside a node, its wait contributes to that node's elapsed time.
3. setStateSync updates L1 and marks the key dirty, without waiting for Redis at that call.
4. flushIfNeeded uses the configured flush policy. Default is on-success; the current predicate checks !runtime.hasFailures(), which is not identical to every caller-visible cancellation/failure outcome. Instrument actual behavior rather than assuming only successful returned results flush.
5. flushToRedis returns immediately when no dirty keys exist. Otherwise it serializes changed states, pipelines SETs, awaits pipeline.exec(), then clears dirty keys.
6. runExecution awaits this flush in finally. Returning the result from try does not resolve the caller until finally completes. The result object is built before this flush.

Measure separately:
- Cold state read/warm-up versus warmed incremental calculations.
- Immediate writes inside nodes versus deferred end-of-workflow flush.
- Dirty-key count, serialized bytes, serialization duration and pipeline round trip.
- No dirty work, policy skip, successful flush and failed flush. Use bounded labels, not indicator keys.
- Whole execution through awaited finally completion. Flush time is nested inside executionMs, so never add it twice.
- Individual pipeline command failures as well as a rejected exec Promise before reporting successful checkpoint coverage. Promise resolution alone is not proof that every write succeeded. Preserve runtime behavior in the metrics-only phase.

Illustration only: 0.8 ms node work + 0.2 ms result construction + 2.5 ms final flush is 3.5 ms across those stages. A 0.8 ms node sum is not whole-execution time.

First reduce duplicate serialization/writes within the existing flush boundary. Keep L1 state, incremental updater reuse and compatibility checks. Change persistence scheduling only if measurements justify it.

#### Optional later background-checkpoint gate

Background persistence is a separate behavior change, not a prerequisite for adding timings. Its contract must include:
- Bounded coalesced dirty state, not one queued job per tick.
- Initially at most one unresolved capture/write per ownership scope; limits on bytes, batch work, retry work and checkpoint age.
- Immutable settled snapshots or equivalent consistent revisions; do not serialize objects while foreground updates mutate them.
- Activation/generation fencing and ordered revisions so stale writers cannot replace newer state.
- Clear only acknowledged dirty revisions. New changes arriving during an in-flight write remain dirty afterward.
- Command-level failures retain required dirty/recoverable state. Define bounded retries and admission pause when coverage age or resource limits are exceeded.
- Stop fences new admission, settles active work, drains required writes and then releases references. Incomplete drains retain recovery-owned state; late callbacks cannot recreate disposed state.

Before enabling it, specify which indicator/rolling/consolidator state and event positions form a consistent checkpoint; the permitted crash-loss window; the reconstruction source; alignment with Stream ACK, variables, portfolio and order boundaries; and the conditions requiring reconciliation.

Example: Redis covers event 100 but RAM has processed through event 110. Restart cannot silently resume with event-100 state or replay events 101–110 with broker side effects enabled just to rebuild indicators. Use a proven side-effect-free reconstruction path or pause.

A Redis write response is not proof of disk durability, failover survival or a complete engine checkpoint. A $vars checkpoint does not cover all indicator/portfolio/external-effect state. Preserve AGENTS.md gates and existing flush behavior until the separate recovery design is ready.

### C4. Current-event versus cumulative node timing

Current nodeTiming adds elapsed time and invocation count across live events. avgMs = totalMs/count. resetForNextBar clears transient outputs and queue state but not these counters; clearNodeTiming is a separate operation.

| Event | Actual node elapsed | Cumulative total | Count | Cumulative average |
| --- | --- | --- | --- | --- |
| 1 | 0.4 ms | 0.4 ms | 1 | 0.4 ms |
| 2 | 0.6 ms | 1.0 ms | 2 | 0.5 ms |
| 3 | 8.0 ms | 9.0 ms | 3 | 3.0 ms |

Event 3 took 8 ms, not the accumulated total of 9 ms or average of 3 ms. A long-run average can hide a slow event.

Required outputs:
- Current event: execution wall time, per-node event totals/invocation counts, flush time and runner cycle.
- Activation cumulative: explicitly labelled totals/counts/averages, preserving existing consumers.
- Across events: p50/p95/p99 from actual event durations with sufficiently small histogram buckets.
- Errors/cancellation: measured elapsed time and outcome rather than omitted slow samples.

Node sums exclude surrounding work and may contain nested execution accounting; they must not replace workflow wall time. Keep detailed per-node diagnostics optional/lightweight and the primary event histogram independent. Reset timing separately from all strategy state.

## 7. Phase D — order-path optimization (P2, measured)

Order submission must be isolated from full BrokerExecutor completion:
prepare → submit HTTP → optional enrichment → owner/result finalization.

- Measure credentials, idempotency lookup/intent, pre-request ownership, broker HTTP, enrichment, post-request ownership and order-cache update individually.
- Keep pre-request intent and client-order ownership protections; they protect early lifecycle events and duplicate submissions.
- Review updateOrderCache's existing read followed by sequential writes. Combine only writes whose dependencies and correctness permit it, and account for partially failed writes; use an atomic server operation only where invariants require one.
- Preserve broker-native/client order IDs and lifecycle routing. Do not delete ownership work just to reduce totalMs.
- Current enrichment is configuration-driven and may be absent for a broker. Inspect actual broker capabilities before claiming an extra request or polling penalty.
- Keep response enrichment synchronous wherever downstream nodes depend on it. A later background enrichment change requires a documented output contract and is not a default optimization.
- Inspect transport connection reuse and deployment geography with measurements. Do not assume keep-alive is absent or hardcode one agent across incompatible hosts/proxies.
- Distinguish broker/network latency from Coreza overhead. Broker submission timing cannot be reduced to zero by engine tuning.
- For orders spanning multiple requests, emit per-request measurements and an operation wall time. For cached results, report cached status without a submission sample.

## 8. Throughput and sequencing constraints

A faster node is insufficient if the full event cycle cannot keep up.
- Measure arrival rate and completed-event rate per representative workflow class.
- In a sequential workflow, sustainable service rate is limited by the whole runner cycle, including awaited broker operations and finalization.
- Under bursts, queue delay can rise while execution duration remains stable.
- Do not run ticks concurrently for a stateful workflow solely to improve throughput; it can reorder indicators, portfolio changes and trade decisions.
- COUNT 10 is a maximum batch size, not a requirement to wait for ten entries. BLOCK 5000 is an idle wait, not a five-second processing interval.
- Do not coalesce/drop ticks or closed bars to create an apparent speedup; that changes strategy behavior. Any explicit future freshness policy is a separate product decision.
- Do not claim faster ingress when aggregation semantics or the number of executed events changed.

## 9. Verification and performance evidence

No runtime code or tests are executed while authoring this plan.

During implementation, use focused verification:
- Timing boundary checks with controllable clocks and delayed XADD, admission, executor, flush and ACK; ensure no phase is omitted/double-counted.
- Multi-event provider frames, multiple workflows per event and multiple entries in a consumer batch.
- Malformed input, execution error, cancellation, cache miss/expiry, ACK error and broker submission error.
- Missing telemetry fields on legacy events, clock skew and future stream-ID timestamps.
- Bars/aggregated bars, raw ticks and broker lifecycle events labelled distinctly.
- Stable cumulative timing contract plus correct per-event diagnostics: 0.4/0.6/8.0 ms events retain those event values while cumulative totals become 0.4/1.0/9.0 ms; cover Loop repeats and failed nodes.
- Empty dirty set, policy skip, immediate state SET, deferred flush, serialization delay, rejected pipeline and command-level failure. Verify execution includes finally and does not double-count flush.
- Histogram buckets distinguish millisecond samples; dashboards handle bucket-schema rollout and label accumulated averages separately.
- If checkpoint scheduling changes later: concurrent dirty revisions, partial writes, stale owners, maximum-age pause, crash windows, stop/drain failure and reconstruction without broker side-effect replay.
- Credential rotation/invalidation, token refresh and stop/restart resource cleanup.
- Strategy outputs and broker request counts remain unchanged for deterministic fixtures.

Benchmark the same revision/configuration/hardware/region with:
1. telemetry off vs telemetry on;
2. warmed simple calculation workflow;
3. warmed indicator/consolidator workflow;
4. first-event and warm-up workflow;
5. controlled broker stub with fixed latency;
6. paper broker workflow to observe real network distribution;
7. sustained expected rate and peak bursts;
8. cache expiry/refresh and background workers active;
9. one workflow and representative concurrent workflows.

Record event count, payload size, input rate, event class, p50/p95/p99, throughput, backlog age, CPU, memory, GC/event-loop delay, Redis commands/bytes and broker HTTP count. Keep baseline and optimized runs comparable; do not present estimates as measured savings. No live-money orders for benchmarking.

## 10. Acceptance and rollout

P0 acceptance:
- All four requested metrics have documented, separate boundaries.
- Execution wall time covers reset/preload, engine completion and required flush.
- Queue timing includes admission and time behind earlier entries in a batch.
- Ingress is not confused with Pub/Sub publish or provider feed age.
- Failed/cancelled events and clock-invalid samples remain visible.
- Telemetry adds zero awaited network operations to normal event handling.
- Quantile buckets resolve the intended millisecond/sub-millisecond range.
- Bounded metric labels and optional sampled diagnostics.

Performance release gate:
- Record baseline before selecting deployment-specific latency SLOs.
- Compare each change with baseline under the same load, including p99 and throughput.
- Provisional instrumentation-overhead goal: no statistically meaningful p95/p99 regression and less than 1% throughput loss; establish an absolute noise allowance from repeated baseline runs before using it as a release threshold.
- Optimization is accepted only when the targeted phase improves beyond measurement noise without a material regression elsewhere or growing backlog at the supported rate.
- No claim of guaranteed zero overhead or universal milliseconds saved.

Roll out independently:
A. timing → B1. logging → B2. workflow cache → B3. credentials → C/D. only the largest measured costs.
Use per-feature gates for behavior-changing optimizations. Retain baseline metric names/definitions while rolling back an optimization. Stop/drain activation-owned resources correctly; never clear stream pending entries, disable idempotency or auto-replay trades to recover performance.

## 11. Implementation touchpoints

| Files / area | Intended change |
| --- | --- |
| market-stream-service/src/types/marketEvent.ts and shared contracts | Optional internal timing provenance; preserve payload compatibility |
| market-stream-service/src/services/MarketDataGateway.ts | Receipt capture; accurate publish stage; remove routine payload logging |
| market-stream-service/src/services/MarketDataSubscriber.ts | Metadata propagation, RAM queue/lookup/XADD observations |
| market-stream-service/src/services/WorkflowCache.ts | Activation-ready definitions and explicit refresh/invalidation lifecycle |
| both services' utils/metrics.ts | Primary/supporting bounded histograms and counts |
| src/services/WorkflowRunner.ts | Per-event lifecycle timestamps, cycle/admission/outcome/ACK timing |
| src/engine/workflowRun.ts | Whole execution/result-build/flush boundaries |
| src/engine/executionRuntime.ts | Optional per-event timing while preserving cumulative contract |
| src/utils/redisRunStorage.ts and workers/RunSyncService.ts | Profile first; storage representation changes only with reader compatibility |
| src/nodes/executors/BrokerExecutor.ts | Request-purpose timings; gated routine logs; retain safety operations |
| src/utils/credentialCache.ts, credentialManager.ts, oauthTokenManager.ts | Prewarm/refresh/invalidation and activation-scoped availability |
| src/utils/orderIdempotency.ts and services/OrderOwnerRegistry.ts | Profile dependencies; safely reduce round trips where supported |
| src/engine/indicatorStateManager.ts | Measure flush cost; optimize serialization before durability changes |

Paths above are relative to coreza-backend unless prefixed otherwise. Confirm adapter/custom-operation coverage and any additional AGENTS.md files before implementation.

## 12. Completion checklist

- [ ] Capture representative baseline and clock uncertainty.
- [ ] Implement and validate the four primary timings.
- [ ] Add runner-cycle/stage evidence without remote telemetry waits.
- [ ] Preserve cumulative timing and history/output contracts.
- [ ] Separate current-event timings from accumulated node statistics.
- [ ] Attribute immediate indicator writes and deferred flushes; classify skipped/empty/error cases.
- [ ] Gate asynchronous indicator checkpointing on a defined recovery contract.
- [ ] Gate routine hot-path logging.
- [ ] Remove activation-definition expiry stalls safely.
- [ ] Prewarm credentials and validate update/revocation behavior.
- [ ] Optimize only the largest measured bookkeeping costs.
- [ ] Preserve event ordering, ownership, idempotency and checkpoint boundaries.
- [ ] Publish comparable before/after p50/p95/p99 and throughput results.
- [ ] Verify rollback and activation stop/drain behavior.

Plan only. Implementation should begin with Phase A, not speculative changes to the engine or persistence model.
