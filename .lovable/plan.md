# BacktestInit: Warm Up Rolling Windows

## Goal

`BacktestInit` already warms up every downstream indicator with the warmup slice of bars. Downstream `RollingWindow` nodes are not warmed, so the first strategy bars run against an empty (not ready) window. Warm the rolling windows from the same warmup bars, per symbol, using the exact key scheme the executor reads at run time.

## Current behavior (verified)

- `coreza-backend/src/backtest/BacktestExecutor.ts` (`executeBacktestInit`) slices bars into `warmupBarsBySymbol` / `remainingBarsBySymbol`, then calls `stateManager.warmUp(...)` for each indicator discovered by `discoverIndicators` (BFS over downstream edges, filtered by `INDICATOR_NAMES`). `RollingWindow` is not in `INDICATOR_NAMES`, so it is never discovered.
- At run time, `IndicatorsExecutor.executeRollingWindowNode` stores and reads the window in the shared `DataContext` under `buildExecutionScopedKey({ userId, workflowId, runId, scope: "rolling_window", parts: [symbol, timeframe] })`.
- The backtest session builds its `DataContext` via `DataContextManager.getInstance().getContext({ executionId, workflowId, userId })` where `executionId` is `effectiveRunId` (`context.runId` or `manual-<backtestId>`), the same value passed to `BacktestSessionManager.createSession`.
- The manual editor path (`/storage/rolling-window` in `src/routes/storage.ts`) uses a separate in-process map keyed by `workflowSessionId`; it is not part of the backtest run and is out of scope here.

## Changes

### 1. Generic downstream discovery — `src/nodes/executors/InitializeIndicatorsExecutor.ts`

- Extract the existing BFS in `discoverIndicators` into an internal helper `discoverDownstreamNodes(startNodeId, allNodes, allEdges, match)` that returns `{ nodeId, name, params }` for every downstream node whose normalized name satisfies `match`.
- Keep `discoverIndicators` as a thin wrapper over it (same signature, same return type) so no existing caller changes.
- Export a new `discoverRollingWindows(startNodeId, allNodes, allEdges)` that matches the normalized name `ROLLINGWINDOW` and returns `{ nodeId, params }`.

### 2. Warm the windows — `src/backtest/BacktestExecutor.ts`

In `executeBacktestInit`, after `warmupBarsBySymbol` is built and next to the indicator warmup loop:

- Discover rolling-window nodes with `discoverRollingWindows(node.id, allNodes, allEdges)`; skip the whole step when none are found or when every warmup slice is empty.
- Resolve the shared context once: `const dataContext = DataContextManager.getInstance().getContext({ executionId: effectiveRunId, workflowId, userId })`. This requires computing `effectiveRunId` (currently defined later in the function) before the warmup block — move that single line up; `isManual` stays where it is.
- Determine the window size per node: `clampWindowSize(node.params.size)` from `rollingWindowHelpers` (same 1–500 clamp the executor applies). Skip nodes whose `size` is an unresolved template (`{{ ... }}`) and fall back to the clamp default, logging a warning.
- Compute the effective size for the run as the max size across discovered rolling-window nodes for a given symbol/timeframe, since all nodes on the same `symbol:timeframe` share one window key. If two nodes declare different sizes, use the largest and log the divergence.
- For each `symbol` in `symbols`:
  - Build the key with `buildExecutionScopedKey({ userId, workflowId, executionId: effectiveRunId, scope: "rolling_window", parts: [normalizeSymbol(symbol), normalizeTimeframe(interval)] })`.
  - Create `new RollingWindow(size)` and push only the last `size` bars of that symbol's warmup slice (older bars would be evicted anyway), preserving chronological order.
  - Store it with `dataContext.setData(key, window)`.
- Count the seeded windows for reporting.

Ordering note: seeding must happen before `BacktestSessionManager.createSession(...)`/`session.runAll()` so the first strategy bar already sees a ready window.

### 3. Report it in the node output

Add to the `data` block of the `BacktestInit` success output:

- `rolling_windows_initialized`: number of `symbol:timeframe` windows seeded.
- `rolling_window_size`: the effective size used (omitted when no rolling-window node exists).

### 4. Node definition text — `src/nodes/RollingWindow.json`

Update the `size` field description to note that in a backtest the window is pre-seeded from `BacktestInit`'s warmup bars, so the window can be ready on the first strategy bar.

## Technical notes

- Symbol/timeframe come from the backtest config (`symbols`, `interval`), never from the rolling-window node's own `symbol`/`timeframe` fields, which are usually templates that cannot be resolved at init time. This matches how indicator warmup already builds its keys.
- Seeding writes the exact object type (`RollingWindow`) the executor expects, so a later `set` call reuses the seeded instance and only re-creates it when the declared size differs — hence taking the max size above.
- No change to `IndicatorsExecutor`, the storage route, or the Redis key format.

## Verification

- Run a backtest whose strategy has `BacktestInit -> ... -> RollingWindow (set)` with `size` smaller than `warmup_period`: on the first bar the node returns `isReady: true`, `count: size`, `remaining: 0`.
- A `RollingWindow` node with `operation: get` for the same symbol/timeframe returns the seeded window before any `set` runs.
- Multi-symbol backtest: each symbol has its own seeded window; `rolling_windows_initialized` equals the symbol count.
- A workflow with no `RollingWindow` node behaves exactly as today (no new fields beyond the zero count, no extra work).
