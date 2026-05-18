# Per-node timing leaks across ticks in live runs

## What you're seeing

In the latest tick of this live workflow:
- Overall run badge = `8ms` (wall-clock from `started_at` to `completed_at` on `workflow_runs`)
- Per-node badges sum to ~`17ms` (e.g. `syncFills` alone shows `14ms`)

The node badge for a single node (`14ms` on `syncFills`) is already larger than the whole run (`8ms`). That cannot be parallelism — it is a real bug.

## Root cause

`WorkflowRunner` (`coreza-backend/src/services/WorkflowRunner.ts:74`) creates **one** `WorkflowEngine` in its constructor and reuses it for every stream tick. Per tick it calls `engine.resetForNextBar(true)` (line 241) to clear results/queues/edge payloads, then `engine.executeFromEntries(...)`.

`BaseExecutionRuntime.routeNodeResult` accumulates timing into `this.nodeTiming` (`coreza-backend/src/engine/executionRuntime.ts:291`):

```text
prev.totalMs += elapsed
prev.count   += 1
```

But neither `BaseExecutionRuntime.resetForNextBar` (line 388) nor `BacktestExecutionRuntime.resetForNextBar` (line 456) ever touch `nodeTiming`. There is a `clearNodeTiming()` method, but `WorkflowRunner` never calls it.

So every persisted `WorkflowExecutionResult.timing` for a live tick contains the **cumulative** node timings since the runner started — not the per-tick numbers. The first tick of a fresh runner happens to look right; every subsequent tick keeps growing. Backtests have the same bug for any session that goes through `WorkflowEngine` without an explicit clear (`BacktestSession.ts` calls `clearNodeTiming` only at start and finalize, lines 118/855, so within a backtest the badge represents the whole backtest, not a single bar — different but related semantics).

## Fix

1. **`coreza-backend/src/services/WorkflowRunner.ts > processMessage`** — call `this.engine.clearNodeTiming()` right after `this.engine.resetForNextBar(true)` on line 241. Now each saved tick result reports only the work done on that tick.

2. **`coreza-backend/src/engine/executionRuntime.ts`** — make this less foot-gunny by clearing `nodeTiming` inside `BaseExecutionRuntime.resetForNextBar` and `BacktestExecutionRuntime.resetForNextBar` whenever `full === true`. The backtest path still keeps cumulative timing across bars because `BacktestSession` calls `resetForNextBar(false)` between bars (per-bar) and only the explicit `clearNodeTiming` at start of run drops it — confirm by reading `BacktestSession.ts:118/855` and leaving its calls intact.

3. **Frontend (`src/hooks/useExecutionHistory.ts > getNodeExecutions`)** — no change. Already reads `timing[nodeId].totalMs`; it will simply show the correct per-tick value once the backend stops leaking.

4. **Optional UX nit** — in `NodeWrapper.tsx` badge tooltip, surface `count` from `payload.timing[nodeId]` so users seeing `2ms (x3)` understand a node ran multiple times in this run/tick.

## Verification

- Open a long-lived live workflow. After the first tick the per-node badge values match the new tick — they no longer grow every refresh.
- Sum of per-node badges for a tick is ≤ wall-clock + a small scheduler delta. With parallel branches the sum can still be larger than wall-clock; that's correct and expected.
- Run a fresh backtest: per-node badges accumulate across bars within the run (unchanged behavior).
- Old runs render exactly as before (we never rewrite stored payloads).

## Out of scope

- Tightening `workflow_runs.started_at` / `completed_at` to wrap only the actual execute call (today `started_at` is the `queued` row insert time). Not needed for the bug above; can be a follow-up if the total badge feels misleading.
