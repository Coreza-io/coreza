# Backtest Loop startup and feedback

## Expected behavior

In the reported workflow, `Edit Fields → Loop` supplies 21 closing prices. With **Skip dependency check** off and batch size 1, the Loop should start from Edit Fields, run its body once per item, and emit `done` once after the final body return. A Loop with multiple genuine startup prerequisites should still wait for them.

## Minimal changes

1. **Identify feedback once per graph.** In [GraphRuntime](../../coreza-backend/src/engine/graphRuntime.ts), classify incoming edges to each Loop using the same reachability rule as [Cluster Execute](../../src/domain/clusters/loopRegions.ts). Start from that Loop's body output, stop traversal at the owning Loop, and use the backend's existing Loop body handle rules for legacy graphs. Use execution edges only. Exclude the done path and keep unrelated incoming edges as startup dependencies. Cache the feedback edge IDs and build the startup dependency list from the remaining edges.
2. **Separate startup and continuation in the dynamic backtest scheduler.** In [BacktestExecutionRuntime](../../coreza-backend/src/engine/executionRuntime.ts), use startup arrivals to start the Loop. Match independent prerequisites by edge ID and keep alternative conditional outputs grouped under the existing branch-origin rules. Preserve the initial input payload and the existing **Skip dependency check** override for startup. For a feedback arrival, require the edge to belong to the target Loop and match its active iteration using the existing `originLoopId` and `iterIndex` metadata. Accept one continuation per iteration and ignore stale or duplicate returns. Ordinary arrivals cannot advance an active Loop.
3. **Keep Loop body and completion routing intact.** Reuse the existing sequential Loop result flags and `loop` and `done` handles. Clear the scheduling state on completion and reset it for each backtest bar and symbol so one bar's arrivals cannot affect another. Workflow Replay and regular backtest bars already share the dynamic runtime for Loop graphs. Execution History will receive Loop results through its existing observer when the Loop actually executes.

## Scope

The scheduling change is limited to the dynamic backtest runtime. Editor Run All, Cluster Execute, live execution and compiled execution retain their existing paths. This plan requires no saved workflow changes or migrations. Testing is outside this plan.
