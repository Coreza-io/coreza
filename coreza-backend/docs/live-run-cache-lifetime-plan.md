# Live-run cache lifetime and manual-run cleanup

Status: implementation plan. PR #870 currently delivers lookup diagnostics only.
Its runtime still uses shared credential L1 = 30 seconds and encrypted Redis L2 =
300 seconds for both manual and live calls. This document does not claim the
lifecycle policy below is implemented or verified.

## Required invariant

State required by an active live activation remains available for the entire
activation, including long idle periods with no orders, bars or node invocations.
A manual cache TTL, shared-cache eviction or per-event completion must not reset
that state. Bounded rolling windows remain bounded; keeping a session alive does
not mean retaining every event or every historical resolved value in memory.

Manual/editor/cluster invocations use short retention for disposable execution
data and release it on completion, failure or cancellation. Real-order coordination,
unflushed writes, variable checkpoints and durable history have independent
correctness requirements even when a manual invocation created them.

## Audited behavior at bd4dda0e

| Path | Current behavior | Required action |
| --- | --- | --- |
| `src/utils/credentialCache.ts` | Global L1 expires after 30s, is capped at 500 entries and can evict an entry; encrypted Redis L2 expires after 300s. | Add an activation-owned credential scope. Global TTL/eviction must not evict its active references. |
| `src/utils/credentialManager.ts` and `src/nodes/executors/BrokerExecutor.ts` | Broker credential caching and order persistence share `shouldPersistRedisState`; currently that flag is initialized true. | Separate credential lifetime policy from order persistence. Do not make live/manual classification disable real-order safeguards. |
| `src/infra/WorkflowCache.ts` and `market-stream-service/src/services/WorkflowCache.ts` | Both use a 60s shared workflow lookup TTL. | Audit both processes. Distinguish the runner's immutable execution snapshot from renewable control-plane lookup caches. Preserve explicit deactivation/revision invalidation. |
| `src/engine/EnginePool.ts` | Idle compiled plans are evicted after 5 minutes. | An active run retains its own plan reference; eviction of the shared lookup entry must not destroy an active plan. Keep the shared cache bounded. |
| `src/engine/workflowRun.ts` and `indicatorStateManager.ts` | Only backtests receive an explicit indicator TTL; manual and live paths both currently receive undefined, which writes Redis state without EX. | Introduce explicit manual versus activation lifetime. Manual state needs bounded retention and scoped cleanup. Live required state survives idle time and bar resets. Preserve backtest behavior. |
| `src/engine/DataContext.ts` | Context borrowing uses reference counts. The method/comment mentioning one-hour stale contexts currently only warns when the count exceeds 100; it does not evict them. | Preserve borrowers and add actual manual disposal/orphan handling. Do not mistake the warning for an implemented TTL. |
| `src/engine/executionRuntime.ts`, `nodeStoreV2.ts`, `WorkflowRunner.ts` | Live per-bar resets clear results/queues and edge payloads while the runner retains its store and runtime. | Preserve current-event result resets. Retain only the declared cross-event state, indicators, rolling buffers and compiled/static definitions. |
| `src/utils/scheduledWorkflowWorker.ts` and `src/services/WebhookService.ts` | Activated broker workflows enqueue executionMode=manual with a reporting activation ID. | Lifetime ownership must follow validated activation context rather than executionMode alone. Technical/manual invocations must not gain a live lifetime merely by supplying an ID. |
| `src/utils/orderIdempotency.ts` and `src/services/OrderOwnerRegistry.ts` | Coordination/ownership records currently use 24h retention. | Protect unresolved submissions and open/pending orders beyond arbitrary timeouts, including manual orders. Retire only under terminal/reconciliation and late-event rules. |
| `src/services/SnapshotCache.ts` | Pending coalesced snapshots currently have a 24h Redis TTL. | Treat unflushed snapshots as pending persistence, not disposable cache. An outage or idle timer must not silently erase the only pending value. |

## Lifetime contract

| Data | Live activation | Manual/editor/cluster |
| --- | --- | --- |
| Workflow graph, static broker registry, compiled parameter plans | Acquire the captured revision at admission and hold it until successful disposal. No periodic graph replacement during an activation. | Borrow bounded shared definitions; release execution-owned references at completion. |
| Decrypted credentials | One bounded activation scope, one initial load per credential revision, no time-based eviction while the owner is active. Replace on validated invalidation or token refresh. | Short shared L1/L2 retention; no activation-owned entry. |
| Shared encrypted credential L2 | Bounded bootstrap/shared fallback; its expiry is allowed because it is not the sole live-session copy. Do not pin all global credential entries indefinitely. | Existing short shared TTL remains bounded. |
| Node state, indicators, rolling windows | Required cross-event state lives with the activation. Enforce configured window/resource limits without evicting required active state. | Disposable state receives a finite TTL and explicit execution-scoped cleanup. |
| Resolved prices, balances, inputs, expressions and event outputs | Re-evaluate each event. Reset transient outputs at existing boundaries. | Re-evaluate the invocation snapshot and release transient values afterwards. |
| Redis copies required for live state/recovery | No data-expiry deadline while required by an active or recovering owner. Use an activation manifest and explicit lifecycle cleanup. A finite owner lease is separate from the data's lifetime. | Disposable data may expire after borrowers finish; pending delivery and order records remain protected. |
| Idempotency, owner/reverse maps, pending fills/snapshots, variable checkpoints | Retain through active use, drain and required reconciliation/late-event windows. | Apply the same correctness rules for real orders and pending durable writes. |

## Implementation sequence

1. Define a trusted runtime lifetime context: authenticated user, workflow,
   activation ID, captured revision, lifetime kind and ownership token/fence.
   Keep it separate from executionMode and reporting mode. Capture it when a
   start is accepted and propagate it through runners, cached engines, tools,
   scheduled/webhook jobs, parallel loop children and continuations. A child
   runId changing must not allocate or dispose the parent activation scope.

2. Build an explicit key/policy inventory for both backend and market-stream
   processes. For each key/map record owner, sensitivity, active lifetime,
   maximum size/window, invalidation, completion cleanup, pending-write behavior
   and orphan recovery. Include credential caches, engine plans, DataContext,
   indicator/node state, rolling buffers, workflow lookups, snapshots, order
   caches/reverse maps, ownership records, event streams and variable checkpoints.
   Distinguish shared definition-cache expiry from required activation state.

3. Add bounded activation-owned credential references with per-key single-flight
   loading. Reuse references across all broker invocations owned by that activation.
   Shared-cache LRU cleanup cannot evict a pinned active reference. Share immutable
   credential revisions across activations only with correct reference counts.
   Enforce admission/resource limits before allocating a new scope; do not evict
   another active run to satisfy a global cache limit.

4. Establish credential freshness before indefinite live reuse. Save/delete,
   rotation, reconnect and OAuth refresh must publish an authoritative revision
   or deletion tombstone to every owning process. Use generation checks so an
   in-flight load cannot repopulate an invalidated/deleted revision. Subscribe and
   reconcile before event admission; reconnect after invalidation-channel loss
   requires authoritative reconciliation. OAuth expiry checks and refresh locking
   remain necessary. Replace all active references with the committed token revision.
   On unresolved freshness, pause/revalidate through the existing recovery contract.
   Never blindly retry an order after an uncertain broker submission outcome.

5. Warm/acquire the required references before producers accept live events.
   Preserve dynamic evaluation and per-bar result resets. Both workflow lookup
   caches must retain an explicit active owner/control registration without adopting
   editor graph changes silently. A new revision takes effect through a controlled
   new activation or the separately defined revision-transition contract.

6. Implement explicit retention by lifetime kind. Give manual indicators and other
   disposable Redis values a documented finite retention policy and completion/
   cancellation cleanup, while preserving asynchronous borrowers. Protect live
   required data from TTL expiry. Preferred live Redis policy: data keys remain
   without EX while owned, registered in an activation manifest; owner heartbeat/
   fencing metadata may have a finite lease. Heartbeats run independently of
   market/order activity. Orphan collection requires verified lifecycle/recovery
   disposition and completed required drains; lease expiry alone is not permission
   to delete recoverable state. If finite data TTLs are chosen instead, provide
   equivalent protection/recovery and stop admission before renewal failure can
   cause state loss. Never resume by silently creating empty indicator/state maps.

7. Stop in order: fence new work, await active work and child borrowers, drain
   variables/fills/reporting/checkpoints, then release disposable references once.
   Failed/incomplete drain retains recovery-owned state. Startup failure, process
   restart, replacement and recovery follow the same identity/fencing rules.
   A worker's per-event finally/destroy must not delete activation-owned state.
   Cleanup targets an exact activation; broad workflow-wide key deletion during
   handoff must not remove another activation's pending writes or order protection.

8. Keep order correctness separate. Preserve broker-side idempotency identities
   and Redis coordination for both live and manual real orders. An unresolved
   submission, open order or pending fill cannot lose owner/reverse mapping just
   because 24 hours elapsed. Terminal/reconciled records can use a defined grace
   period. Pending snapshots and fills may be removed only after acknowledged
   durable persistence, using version-aware deletion where concurrent writes exist.

9. Extend existing per-call diagnostics with actual executionMode, lifetime kind,
   trusted activation identity, cache policy and source, including
   live_session_memory. Record explicit invalidation/release/expiry reasons without
   secrets, credential names/values or resolved payloads. Distinguish successful
   reads/writes from attempted storage paths and preserve observer isolation.
   Timing durations are measurements; cache TTLs and OAuth/lock expiry are separate
   mechanisms and must not be conflated.

## Acceptance criteria for the lifecycle implementation

These are implementation completion criteria, not claims of checks run in this review.

- Active live runs retain required memory and Redis state beyond 30s, 5min, 60s,
  24h and configured manual TTLs, including idle periods with no market events.
  Shared fallback expiry does not cause repeated credential Redis/database reads
  after live warmup when there is no credential invalidation or token refresh.
- Session-owned scheduled/webhook/loop/tool invocations with different event IDs
  use the same validated scope even when executionMode remains manual. Standalone
  manual, cluster and editor invocations never acquire that scope.
- Manual execution completion/error/cancellation reclaims disposable owned data
  after borrowers finish; unused fallback keys expire and memory/key counts remain
  bounded. Real-order and pending-persistence records remain protected.
- Credential revision changes, deletion, reconnect, concurrent loading, invalidation
  during a load, lost/reconnected invalidation delivery and OAuth refresh cannot
  leave stale credentials pinned or resurrect a deleted revision.
- Two users and two active runs sharing a credential remain isolated. Stopping one
  owner does not evict another. Failed startup/drain and restart/replacement retain
  the required recovery state without automatic order replay.
- Indicator/rolling state survives live bar boundaries, while current inputs,
  prices, balances, quantities and variables continue changing each event.
- Long-lived pending/open orders, uncertain submissions, delayed fills and database/
  Redis interruptions retain deduplication, attribution and pending writes.
- Definition-cache eviction, a lost owner lease, and orphan collection cannot
  destroy active/recoverable data. Cleanup is scoped, fenced and drain-aware.

## Delivery status

Implemented in PR #870: request-scoped lookup-source/timing diagnostics.
Not implemented by the current runtime commits: the lifetime contract above.
The lifecycle feature is not end-to-end complete until its owning paths, invalidation,
retention and cleanup satisfy the acceptance criteria. No tests, broker calls,
Redis/database mutations or lifecycle implementation were performed for this plan review.
