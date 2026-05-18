# Fix per-node execution time badge (same value on every node)

## What's wrong

In the execution detail view, every node shows the same duration (e.g. `1ms`, `1ms`, `1ms`). The badge is not the real time the backend spent on that node — it is the total run time divided by the number of nodes, then applied uniformly to all of them.

## Root cause

Two-part bug across backend and frontend:

1. **Backend already measures real per-node timing but never persists it.**
   - `coreza-backend/src/engine/executionRuntime.ts` records `nodeTiming` per node (`totalMs`, `count`) on every `routeNodeResult` call.
   - `WorkflowExecutionResult` type (`engine/types/executionError.ts`) already has an optional `timing` field for exactly this.
   - `coreza-backend/src/engine/workflowRun.ts > buildExecutionResult()` / `buildFailureResult()` build the payload that gets saved into `workflow_runs.result`, but they only include `nodeResults` and `executionOrder` — they never call `this.runtime.getNodeTiming()`. So the saved payload has no per-node timing.

2. **Frontend fakes per-node duration by averaging total run time.**
   - `src/hooks/useExecutionHistory.ts > getNodeExecutions()` (lines ~550-585):
     ```text
     totalDurationMs = completed_at - started_at
     estimatedDurationMs = totalDurationMs / executionOrder.length
     ...
     nodeExecutions.push({ ..., durationMs: estimatedDurationMs })
     ```
     Every node gets the **same** `estimatedDurationMs`, which is why the badge is identical on every node.
   - `ExecutionDetailView.tsx` passes `nodeExec?.durationMs` straight into `NodeWrapper`'s `executionDuration` prop, which renders the badge.

## Fix

### Backend (`coreza-backend/`)

1. **`src/engine/workflowRun.ts`** — In both `buildExecutionResult()` and `buildFailureResult()`, include the real timing map:
   ```text
   const timing = this.runtime.getNodeTiming();
   return { success, nodeResults, executionOrder, timing, ... };
   ```
   No other shape changes; consumers that ignore `timing` keep working.

2. **No type change needed.** `WorkflowExecutionResult.timing` already exists.

3. **Persistence path.** `RunSyncService` already writes the whole `result` object to `workflow_runs.result`, so once `timing` is in the payload it lands in the DB automatically — no migration, no schema change.

### Frontend (`src/`)

4. **`src/hooks/useExecutionHistory.ts > getNodeExecutions()`**
   - Remove the `estimatedDurationMs = totalDurationMs / executionOrder.length` fallback that assigns the same value to every node.
   - Read real per-node timing from `payload.timing?.[nodeId]`. Use `totalMs` (rounded to ms) as `durationMs` — this matches what the backend actually spent on that node, including all incremental updates for loops/streaming nodes.
   - When `payload.timing` is missing (older runs persisted before this fix), set `durationMs: 0` so the badge is hidden (the existing `executionDuration > 0` guard in `NodeWrapper.tsx` already does this) instead of showing a misleading uniform value.

5. **No changes to** `NodeWrapper.tsx`, `NodeRouter.tsx`, or `ExecutionDetailView.tsx` — they already consume `durationMs` correctly; they were just being fed a fake value.

## Verification

- Run a manual workflow with mixed-cost nodes (e.g. a fast `Switch` and a slower `getBrokerBalance`/HTTP node).
- Open the run in the Executions view: each node badge shows a distinct value reflecting its real cost (e.g. `Switch 0ms`, `getBrokerBalance 240ms`, etc.), not the same `1ms` on every node.
- Old runs persisted before the backend fix simply show no badge (graceful fallback) instead of a fake uniform number.
- Failed runs also carry timings (covered by `buildFailureResult` change).
