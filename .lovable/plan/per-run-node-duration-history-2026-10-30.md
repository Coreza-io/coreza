# Per-run node duration in execution history

Date: 2026-10-30
Status: Implemented in source; runtime acceptance checks remain pending.

## Problem and evidence

The supplied broker log reports `TRADE_TIMING.totalMs = 782.207`, including
`httpMs = 777.889`. The history node badge shows approximately 4.1 seconds,
while the selected history row shows approximately 784 ms for the run.

The code establishes a scope mismatch:

- `coreza-backend/src/engine/executionRuntime.ts`: `routeNodeResult` adds elapsed
  node time to `nodeTiming.totalMs` and increments `count`.
- Its live `resetForNextBar` clears results, queue and execution order, but does
  not clear `nodeTiming`.
- `coreza-backend/src/services/WorkflowRunner.ts`: one engine is reused across
  live events, each with a new `runId`; it resets the engine before each event.
- `coreza-backend/src/engine/workflowRun.ts`: `buildExecutionResult` snapshots
  the accumulated timing into each run result.
- `src/hooks/useExecutionHistory.ts`: `getNodeExecutions` reads
  `payload.timing[nodeId].totalMs` as the node's duration.
- `ExecutionDetailView` passes this duration through to `NodeWrapper`, which
  formats it as milliseconds or seconds.

Thus the badge can represent multiple previous invocations instead of the
selected run. The exact 4.1-second sum cannot be reconstructed from screenshots;
verify comparison using the same workflowId, nodeId and runId.

## Duration contract

The canonical node duration is engine-measured elapsed time around executor
execution and result normalization, using the existing monotonic clock.

- Single invocation in a run: that invocation's elapsed milliseconds.
- Multiple invocations of a node within one run: total time for those invocations;
  preserve count and average. Do not replace the total with the average.
- A node not invoked in this run must not inherit timing from previous events.
- Workflow row duration remains the whole run's elapsed time. It need not equal
  one node's duration, or the sum of node durations when work overlaps.
- Broker HTTP time measures only the request; `TRADE_TIMING.totalMs` measures
  the broker executor. They remain useful breakdowns and are not relabeled as
  engine node duration. Small differences from engine duration are expected.

## Minimal implementation

1. In `WorkflowRunner.executeMessage`, call the existing
   `this.engine.clearNodeTiming()` at the preparation boundary for each admitted
   event, adjacent to `resetForNextBar(true)` and before preloading/executing.
   This covers bar and order-update events. Do not change shared reset semantics:
   backtest sessions intentionally accumulate timing across bars.
2. Keep the persisted `timing: { nodeId: { totalMs, avgMs, count } }` shape and
   history reader. Confirm result construction copies numeric timing values so
   later resets/invocations cannot mutate an already-built run snapshot.
3. Clarify the history duration tooltip: total node execution time in the selected
   run; where count exceeds one, expose count/average if already supported by the
   existing UI. Avoid adding new UI solely to support this fix.
4. If identical log-to-history comparison is needed, emit an engine `NODE_TIMING`
   debug entry from the already-computed elapsed sample, carrying workflowId,
   runId, nodeId and durationMs. For repeated invocations, identify it as an
   invocation duration, while history shows the run total. Retain `TRADE_TIMING`
   as the executor/HTTP breakdown. Do not add network calls or another enable flag.
   The core correction does not depend on adding this log.

## Verification and acceptance

No automated tests are to be added or run, per the current user constraint.
Use static checks and a manual paper-workflow exercise when runtime access exists:

- Run several events through the same activation, alternating buy/close orders.
  Each selected run's badge should track its own timing, rather than grow over time.
- Inspect persisted timing by runId: a node invoked once should have count 1;
  a node absent from the next event should have no carried-over entry.
- Compare the selected run's badge to its persisted totalMs, allowing only display
  rounding. Compare executor logs separately with their documented boundaries.
- Include several invocations within one run, an order-update event, a failed
  broker operation, and viewing an older run after newer runs complete.
- Type-check changed code, compare any errors with the baseline, and inspect the
  diff. Verify backtest timing accumulation remains unchanged by source review.

## Limits and rollout

No schema migration, frontend arithmetic correction, new timer map, per-tick I/O,
strategy ordering change, state reset change or broker-call change is needed.
Do not divide old totals by count to manufacture a per-run value: the individual
historical duration cannot be recovered from an activation-wide aggregate.
Existing records remain legacy cumulative data; only newly recorded live runs
will have corrected timing. Document this cutoff rather than rewriting history.
Unexpected thrown executors can bypass `routeNodeResult` timing in the existing
runtime; do not invent a duration for those records. Broader failure-path timing
coverage is separate from correcting cumulative live-run totals.
