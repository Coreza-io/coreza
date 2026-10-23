# Detailed review: live execution performance plan against dev
Reviewed: 2026-10-18
Repository: Coreza-io/coreza
Branch: dev
Reviewed runtime baseline: 7dd141069c2e39040d85ecdaec4ed21819b64ea8
Verdict: REVISE BEFORE IMPLEMENTATION. Selected changes should reduce avoidable work, but the restored plan is not safe to implement as one end-to-end change and does not establish a measured speedup or issue-free operation.
Scope: source and design review only; no runtime changes, deployment configuration inspection, tests, builds, broker calls or load benchmarks performed. Live compilation remains excluded.

## 1. What was reviewed

The restored October 13 performance/recovery proposal is the review input. It was absent at its original path on dev at review time; the restored proposal from the conversation was evaluated against actual dev source. Main was checked initially before the user clarified branch scope; every source finding below was subsequently verified using ref=dev. Dev was confirmed unchanged at the runtime baseline before this report was written.

Inspected live ingress, Redis topology, runner/manager, dynamic runtime, workflow variable state/session/protocol/worker, indicator persistence, run-history Redis storage and SQL synchronization, activation/deactivation, history query/repository, API startup and both shutdown integrations. This is not a complete security audit of all SQL migrations or all broker executors.

Current AGENTS.md and the implemented variable ownership/eligibility contract control implementation. Historical baseline rows in the proposal must not be treated as current defects without rechecking them.

## 2. Summary of plan acceptance

| Plan item | Dev status | Review decision |
| --- | --- | --- |
| Reuse one dynamic live engine, sequential ticks | Already present | Keep |
| Clear per-event failure state | Still missing in inspected resets | Fix before performance changes |
| Inspect returned success:false | Already present | Keep; extend failure/cancellation result publication |
| Typed runner identity and late-crash cleanup guard | Already present | Remove obsolete missing-property claim; review remaining start/stop races |
| RAM-first eligible workflow variables | Implemented behind policy/flags | Reuse and validate, do not replace |
| Save graph snapshot once per session | Not present in inspected live run writer | Good candidate after reader/schema compatibility |
| Batch completion metadata/status writes | Missing from original explicit work list | Add first; small scope and direct RTT reduction |
| Background indicator flushing | Not present; current flush is awaited | Conditional, requires dirty-version and restore contract |
| Generic checkpoint plus stream ACK transaction | Not implemented; incompatible with present assumptions | Remove from initial performance scope |
| 25 ms / 100 event / 8 MiB coordinator defaults | Proposed only; not workload-derived | Do not apply to existing variable subsystem |
| Compact live diagnostics | Detailed result building remains | Measure and add only as explicit live policy |
| Persistent process pool | Runner remains process-local | Defer until CPU/event-loop/load evidence |
| Recovery-aware stream retention and reclaim | Gaps remain | Correctness prerequisite, not evidence of lower per-tick CPU cost |

## 3. Findings requiring changes

### R1 — High: the plan duplicates an existing variable persistence subsystem

Evidence:
- src/engine/workflowRun.ts commitVariables applies changes through liveVariables.state.apply synchronously for eligible live sessions.
- src/variables/LiveVariableState.ts already provides bounded dirty keys, frozen scalar values, bigint generations and settled full snapshots.
- src/variables/LiveVariableSession.ts already provides ownership, recovery lineage, one unresolved capture, bounded shared transport scheduling, publish/retry and drain/seal/handoff.
- src/workers/LiveVariableCheckpointWorker.ts already synchronizes dirty scopes to SQL.
- docs/workflow-variables.md and AGENTS.md explicitly limit the eligible state and recovery guarantees.

Risk: implementing the proposed generic coordinator as a second owner creates competing generations, duplicate snapshots, inconsistent stop behavior and additional serialization. It may slow execution and violate ownership.

Required correction: split the proposal into separate variable checkpoints, indicator state, and event history responsibilities. For variables, change only measured deficiencies in the existing subsystem. Preserve LIVE_VARIABLE_WRITE_BEHIND_ENABLED, LIVE_VARIABLE_CHECKPOINT_WORKER_ENABLED, durability attestation and policy eligibility. Source code presence does not prove that these flags, migrations or policies are enabled in the deployed system.

### R2 — High: proposed checkpoint/ACK and replay semantics exceed the existing contract

The current variable snapshot has source event/outcome metadata, not a complete execution checkpoint. It does not include all indicator/consolidator/window/node/portfolio state or arbitrary external-read results. The variable protocol's "ack" operation means SQL checkpoint progress, not Redis XACK of strategy input.

The runner still XACKs events independently. The current design explicitly does not skip input on variable checkpoint coverage and does not promise per-invocation replay or automatic order failover.

Risk: interpreting a variable generation as an executed-event cursor can skip unperformed work; replaying a stream event against already advanced variables can mutate twice or duplicate broker actions. Delaying ACK alone does not solve either issue.

Required correction: do not change source ACK semantics or add automatic replay as a performance optimization. A generic execution checkpoint and action-intent journal require a separately designed, tested project. Retain approved recovery and explicit ambiguous-order reconciliation. If history buffering is introduced, define its own durable acceptance boundary without upgrading variable checkpoints into execution receipts.

### R3 — High: the stream producer and consumer select different Redis topologies

Evidence:
- market-stream-service/src/services/MarketDataSubscriber.ts appendToWorkflowStream uses getRedisCache().
- src/services/WorkflowRunner.ts creates its consumer through createDedicatedStreamConnection().
- src/config/redis.ts maps createDedicatedStreamConnection to queue Redis.
- The market service and backend Redis configurations independently support REDIS_CACHE_URL and REDIS_QUEUE_URL, or separate Sentinel masters.

Impact: when cache and queue point to different logical Redis databases/servers, the producer appends to one stream and the consumer waits on another. When both resolve to the same database, this problem is masked. Deployment topology was not inspected, so this is a confirmed source mismatch with a conditional production trigger, not a claim that current production is broken.

Required correction: establish one strategy-stream topology across producer, consumer, inspection routes, cleanup and tests. Prefer durable queue topology for recovery-relevant input, but migrate explicitly; do not silently abandon pending cache streams. A single atomic script cannot span separate Redis servers even if each server is standalone. Cluster hash slots are an additional issue, not the only one.

### R4 — High: error state is still retained between events

src/engine/executionRuntime.ts owns failed and failedNodeErrors. Neither StandardExecutionRuntime.resetForNextBar nor BacktestExecutionRuntime.resetForNextBar clears them. workflowRun.ts uses hasFailures for outcomes and indicator flush policy.

Impact: a failed event followed by a successful one can remain classified failed, and on-success indicator flushing can remain suppressed. Correctness must be restored before attributing performance changes to flushing.

Correction: clear only per-event failure/error/routing state, preserve session variables, pins and intended node state, and test failure -> success and failure -> cancellation. Keep backtest behavior covered because this is shared code.

### R5 — High: pending input can be overtaken or automatically replayed without the required recovery checks

WorkflowRunner.reclaimPendingMessages performs one XAUTOCLAIM COUNT 10 at startup, ignores the returned next cursor/deleted IDs, and then polls only new entries. A createRunInRedis failure leaves an event pending but executeMessage returns normally, allowing later events in the batch to proceed. ACK failures are logged and processing continues.

Impact: sequential awaiting is not enough to establish a contiguous processed prefix. More pending entries can remain unhandled; older state-relevant work can be skipped over; previously effected work can be re-executed on reclaim.

Correction: classify pending causes and preserve the recovery policy for side effects. Block overtaking on pre-execution persistence/admission failures. Drain appropriate pages in a defined order, detect retention gaps, and require approved recovery where a prior effect is possible. Do not merely add periodic unconditional XAUTOCLAIM, which could repeatedly replay ambiguous effecting events.

### R6 — High: bounded runner buffers do not bound ingress

MarketDataSubscriber appends events to per-workflow/domain promise chains without an explicit record/byte bound. It also uses approximate stream MAXLEN 1000. A slow Redis command or paused runner can create ingress promise backlog or trim unprocessed stream input.

Correction: define ingress queue budgets and an overload policy in addition to runner budgets. Measure gateway-to-stream and stream-to-execution lag separately. Do not promise unlimited every-tick delivery with finite memory during an unlimited outage. For finite overload, preserve all events within the declared retention envelope; outside it, fail visibly and require explicit recovery. Provider replay availability must be checked rather than assumed.

### R7 — High: history storage can lose discoverability and shutdown can fail to finish

utils/redisRunStorage.ts LPUSHes runs and LTRIMs to 10,000 IDs. RunSyncService reads the newest 500 per user every 10 seconds. Sustained arrival can starve older records before trimming removes their queue references. Orphaned/missing hashes and nonterminal records can leave entries that flushAll cannot clear.

The nominal scheduled batch budget is 500 / 10 = 50 examined records per second per user, before incomplete entries, DB latency and skipped intervals; this is an arithmetic configuration observation, not measured throughput.

Correction: reliable terminal-history discovery, oldest-first bounded fair draining, explicit retention/overflow handling, per-command pipeline errors, and a finite no-progress/deadline shutdown. Removing LTRIM alone would replace silent loss with unbounded memory and is insufficient.

Also review registry removal races: an empty-list observation followed by registry SREM can race a new run registration. Use an atomic discovery/removal protocol or deterministic repair sweep.

### R8 — High if background flushing is enabled: the existing indicator dirty-set algorithm is unsafe to reuse unchanged

indicatorStateManager.flushToRedis serializes dirty entries, awaits pipeline.exec, then clears the entire dirty set. It does not inspect each pipeline command error.

With the current sequential awaited owner, update-during-flush overlap is more limited. Moving this method into background execution introduces a concrete race: a newer dirty update arrives while an older flush waits, then the completion clears the newer dirty marker.

Correction: captured immutable payloads, per-key versions and conditional clearing of only the captured versions; retry failed individual operations without losing their markers. Keep indicators separate from scalar $vars and specify their cache/restore durability before deferring flushes. Do not just remove await or set flushPolicy=never for live.

### R9 — Medium: completion writes contain an immediate, smaller optimization opportunity

For runs with both variable revision and checkpoint metadata, recordSuccess/recordFailure awaits:
1. HSET variable_revision;
2. HSET variable_checkpoint;
3. updateRunStatusInRedis, another HSET of status/result/error.

All use cache Redis through RedisOps. They can be assembled into one terminal HSET without introducing a new coordinator or weakening the execution/ACK boundary.

Expected improvement: up to two application-level awaited Redis calls removed from this path; actual latency gain depends on RTT, client behavior and serialization. This does not remove create-run, indicator flush or XACK latency. Keep variable registry values out of run output.

Required validation: success/failure/cancellation, absent metadata, serialization failure, cache error, and history read compatibility. Do not label a terminal write accepted on a partial or ambiguous response.

### R10 — Medium: failure/cancellation history and checkpoint metadata are incomplete

The runner now checks executionResult.success, so the original missing-outcome check is obsolete. But false results are reduced to new Error(message) and recordFailure stores only errorMessage; available failed node snapshots/outcomes are not passed through. Cancellation is not given a distinct runner terminal status here.

RunSyncService copies variable_revision but does not copy variable_checkpoint before deleting synchronized Redis hashes. Recovery state remains in its own protocol; the problem here is loss of diagnostics/history metadata, not loss of authoritative variable checkpoints.

Correction: terminal publication should preserve the canonical execution result/error and a separately defined safe diagnostic metadata schema through Redis -> SQL -> history API. Add schema support before sending unknown SQL columns. Select only metadata needed by consumers, not variable values.

### R11 — Medium: snapshot deduplication is valuable but reader compatibility is a deployment prerequisite

Current live records repeat nodes/edges. A session snapshot reference can reduce bytes significantly for large graphs/high event rates. However WorkflowQueryService delegates history reads to WorkflowRunRepository, which currently reads workflow_runs directly. There is no inspected session-snapshot hydration contract there.

Correction: additive immutable snapshot persistence, user authorization, stable revision linkage, referenced snapshot lifetime, old inline fallback and server-side hydration before compact writers. Capture complete canonical metadata, including clusters/format and display names; current runner constructor only receives nodes/edges, so the data acquisition boundary needs explicit design. Never hydrate historical runs from today's mutable workflow.

If SQL still expands/stores full nodes/edges per event, only Redis/transit savings are achieved. If SQL references snapshots too, database and all history consumers need migration. Quantify these separately.

### R12 — Medium: shutdown has multiple independent signal handlers

index.ts installs SIGINT/SIGTERM handlers that stop runners, variable worker/connections and history/fill synchronization, then exit. jobQueueManager.ts also registers GracefulShutdownHandler signal handlers that drain queue resources and call process.exit through a different path.

Risk: future buffered history/checkpoint work can be interrupted by the handler that finishes first. Improving only GracefulShutdownHandler does not make the API shutdown end-to-end complete.

Correction: one orchestrating shutdown promise with one exit decision, or shared coordination across handlers. Preserve variable stop budgets, active-event settle, retained incomplete authority, seal/handoff, input pending state and safe connection closure. Explicitly await the poll loop to quiesce/unblock rather than assuming activeMessage covers an outstanding XREADGROUP. Test idle blocking reads, executing events, pending initialization and unavailable persistence.

## 4. Settings that must not be applied blindly

The proposal's 25 ms checkpoint deadline is ten times shorter than LiveVariableSession's nominal 250 ms nextPublish cadence. The shared scheduler visits at most four sessions each 100 ms, so actual revisit/publish timing also depends on session count, transport contention and retry backoff. This is not a fixed 250 ms guarantee.

Reducing cadence can increase JSON encoding, hashing, payload copying, Redis writes and SQL demand. It may raise event-loop lag and harm p99 decision latency. It primarily changes recovery coverage, not local variable read/write speed.

Current admission has 2 s unresolved Redis/event coverage and 30 s SQL coverage bounds. A workflow that waits on an external node for more than the allowed event duration may safety-stop while the event is in flight; moving persistence does not make that external operation faster. Keep eligibility and limits explicit rather than loosening safety rules to claim a faster run.

An 8 MiB per-run buffer plus process budgets is not a replacement for existing scalar variable limits and global scope/transport caps. Preserve those contracts; size any new history buffer separately.

## 5. End-to-end performance assessment

### Current dependency chain
Market gateway -> subscriber delivery queue -> stream XADD -> runner XREADGROUP -> run creation -> reusable engine -> optional awaited external executor/SQL fallback -> settle variable event -> indicator flush -> terminal metadata/status -> XACK.
In parallel, eligible $vars use bounded background Redis checkpoints and a SQL checkpoint worker; history synchronization runs periodically.

### What should improve speed, conditionally
- Merge terminal metadata and status into one HSET: removes redundant awaited calls.
- Store immutable graph snapshot once: reduces repeated bytes; savings scale with graph size/rate.
- Compact/sample diagnostics: reduces per-event CPU/allocation when result/timing construction is material.
- Safe asynchronous indicator persistence: can remove a flush wait, but changes durability and needs the R8 safeguards first.
- Reuse current eligible variable write-behind: avoids SQL in changed-variable writes for eligible scopes, but implementation already exists.

### What does not establish faster single-event execution
- Fixing outcome/reset bugs: necessary correctness, not a demonstrated speedup.
- More checkpoint writes: may reduce recovery lag while increasing execution contention.
- Larger read batches: amortizes reads only under backlog and can worsen fairness.
- Adding process/worker hops: helps isolation/capacity if CPU constrained, but can add latency for a small workflow.
- Parallel ticks of a stateful workflow: changes semantics and remains excluded.
- Removing ACK/persistence waits without a contract: trades away guarantees rather than proving an equivalent optimization.

## 6. Recommended revised delivery order

1. Establish a dev-only source baseline and complete deployed topology/flags/policy inventory. Correct stream Redis alignment and quantify source/backlog behavior.
2. Fix remaining failure reset and partial failure/cancellation history. Keep already implemented identity/outcome checks.
3. Instrument stage latency and load: no need to replace engine or variable ownership.
4. Merge terminal HSETs. Verify equal results and quantify removed waits.
5. Snapshot reference migration with reader-first rollout and retention guarantees.
6. Repair reliable history backlog/discovery and unify shutdown before adding more async buffers.
7. Introduce live-only compact diagnostics based on measured cost.
8. Consider version-safe indicator write-behind separately after restore/durability tests.
9. Validate and selectively enable existing variable write-behind under current policy; do not replace it.
10. Consider persistent process isolation only after demonstrating CPU/event-loop contention, with ownership and effect-recovery gates.
11. Treat full execution checkpoint/ACK/replay redesign as deferred, separately approved scope. Live compilation remains excluded.

This order reduces change size and avoids coupling immediate speed improvements to a new recovery engine.

## 7. Required acceptance evidence

| Boundary | Required scenario and expected result |
| --- | --- |
| Topology | Distinct cache/queue Redis instances and logical databases; producer and consumer use the intended same stream |
| Runtime reuse | Failed event -> successful event; no leaked failure state, unchanged retained variables and indicators |
| Variable modes | Eligible on, flag off, ineligible, read-only, manual and backtest; correct RAM/SQL/overlay path |
| Existing checkpoint protocol | Update during publish, delayed renewal, receipt ambiguity, SQL lag, lease loss and incomplete stop; no lost dirty state or bypassed recovery |
| History | More than 10,000 events and sustained SQL outage; bounded resources, fair progress, no silent history loss |
| Source order | Pre-execution create failure, ACK failure, multiple pending pages and retention gaps; no unapproved replay or overtaking |
| Snapshot readers | Legacy inline and new references resolve identical historical definitions with tenant checks |
| Indicator batching | New mutation while flush waits and individual pipeline failure; latest dirty version retained |
| Shutdown | Both signal entry points, idle XREAD, active node, initialization and unavailable SQL/Redis; one bounded exit contract |
| External action | Broker acceptance followed by timeout/crash; no unsupported automatic resubmission |
| Performance | Same event sequence, graph, flags, hardware and I/O stub latency; p50/p95/p99 decision, full service and durable-coverage latency |
| Saturation | Sustained and burst input plus competing backtest; bounded memory, event-loop lag, oldest queue age and completed-event count |

Measure cold startup separately from warmed execution. Distinguish time-to-decision, time-to-order-submit, broker response, history visibility and recoverable checkpoint coverage. A shorter time-to-decision with a longer/lossy history queue is not equivalent end-to-end acceptance.

Source documentation records important current validation as not run; historical evaluator/unit results do not prove the current deployed write-behind behavior. This review did not execute tests or benchmarks. No issue-free or numeric speedup guarantee is justified yet.

## 8. Review conclusion

Keep the reusable sequential engine. Reuse existing RAM-first eligible variables. Implement redundant completion-write removal, snapshot reuse and measured diagnostics reductions in small steps. Correct topology, ordering, history and shutdown gaps before increasing asynchronous work. The restored plan needs this restructuring before implementation.

No runtime source files changed by this review. The only GitHub write is this review document on dev.
