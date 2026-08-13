# BacktestInit: Warm Up Rolling Windows (reuse the indicator warmup path)

## Goal

`BacktestInit` already discovers downstream indicators and warms them from the warmup slice of bars. Reuse that exact discovery + per-symbol loop for `RollingWindow` instead of adding a parallel mechanism, so the change is as small as possible.

## Why RollingWindow can't be a plain indicator

Verified: `IndicatorStateManager.warmUp()` calls `IndicatorService.createIncrementalUpdater(indicator, params)` and stores an `IndicatorState` (Redis/RAM). `RollingWindow` has no incremental updater, and at run time `IndicatorsExecutor.executeRollingWindowNode` reads its window from the shared `DataContext` under `buildExecutionScopedKey({ userId, workflowId, runId, scope: "rolling_window", parts: [symbol, timeframe] })` — not from indicator state.

So simply adding `ROLLINGWINDOW` to `INDICATOR_NAMES` would throw in `warmUp` and seed nothing. What we can reuse is the **discovery walk and the warmup loop**; only the "how to warm" leaf differs.

## Changes (two files, ~30 lines)

### 1. `src/nodes/executors/InitializeIndicatorsExecutor.ts`

- Add `export const WARMUP_NODE_NAMES = new Set([...INDICATOR_NAMES, "ROLLINGWINDOW"]);`
- In `discoverIndicators`'s BFS, match against `WARMUP_NODE_NAMES` instead of `INDICATOR_NAMES`. The returned shape (`{ nodeId, type, params }`) is unchanged; a rolling-window node comes back with `type: "rollingwindow"`.
- In the executor's own warmup loop (the live `InitializeIndicators` node), skip entries with `type === "rollingwindow"` so nothing changes there for now — only the backtest path seeds windows.

No new discovery function, no BFS duplication, no refactor of `discoverIndicators`.

### 2. `src/backtest/BacktestExecutor.ts`

- Move the existing `const effectiveRunId = context?.runId || \`manual-${backtestId}\`;` (line 482) above the warmup block so seeding uses the same run id the session's `DataContext` uses. `isManual` stays where it is.
- Resolve the context once before the loop: `const dataContext = DataContextManager.getInstance().getContext({ executionId: effectiveRunId, workflowId, userId })`.
- Inside the existing `for (const currentSymbol of symbols) { for (const ind of discoveredIndicators) { ... } }` loop, add one branch at the top of the inner body:

```ts
if (ind.type === "rollingwindow") {
  const size = clampWindowSize(ind.params?.size);
  const key = buildExecutionScopedKey({
    userId, workflowId, runId: effectiveRunId,
    scope: "rolling_window",
    parts: [normalizeSymbol(currentSymbol), normalizeTimeframe(interval)],
  });
  let window = dataContext.getDataByKey(key) as RollingWindow<unknown> | undefined;
  if (!window || window.size !== size) {
    window = new RollingWindow(size);
    dataContext.setData(key, window);
  }
  for (const bar of symbolWarmupBars.slice(-size)) window.add(bar);
  rollingWindowsInitialized++;
  continue;
}
```

Because two rolling-window nodes on the same `symbol:timeframe` share one key, the existing-window reuse above keeps the first-created size; declaring different sizes on the same symbol/timeframe logs a warning and keeps the larger by creating with the max size seen for that key.

- Guard: the surrounding block currently requires `stateManager && discoveredIndicators.length > 0` — keep it; a rolling-window-only workflow still satisfies `discoveredIndicators.length > 0` since discovery now includes it.

### 3. Output + docs

- Add `rolling_windows_initialized` to the `BacktestInit` success `data` block.
- `src/nodes/RollingWindow.json`: note in the `size` description that in backtests the window is pre-seeded from `BacktestInit` warmup bars.

## Review corrections (verified against the code)

- Node name matches: `src/nodes/RollingWindow.json` has `"name": "RollingWindow"`, so the BFS's `toUpperCase().replace(/\s+/g,"")` normalization yields `ROLLINGWINDOW`. Good.
- `BacktestExecutor.ts` needs four new imports it doesn't have today: `RollingWindow` (`../engine/RollingWindow`), `clampWindowSize` / `normalizeSymbol` / `normalizeTimeframe` (`../engine/rollingWindowHelpers`), `buildExecutionScopedKey` (`../utils/executionKey`), and `DataContextManager` (`../engine/DataContext`). Import `rollingWindowHelpers` by its exact filename — do not use a `../engine/rollingWindow` path (the earlier case-collision bug).
- Two other callers of `discoverIndicators` now see rolling-window entries and must skip `type === "rollingwindow"`: `InitializeIndicatorsExecutor.execute`'s warmup loop **and** the `POST /indicators/initialize` route that drives it (it just forwards to the executor, so the executor-side skip covers both). Also skip them in the `indicators_total` count so the live node's report stays accurate.
- `ind.params.size` can be an unresolved `{{ ... }}` template; `clampWindowSize` already falls back to 20 via `parseInt(...) || 20`, so no crash — just log a warning when the raw value isn't numeric.
- `RollingWindow`'s constructor throws for `size <= 0` or `> 500`; `clampWindowSize` clamps to 1..500 first, so construction is safe.
- Shape check to confirm during implementation: seeding pushes raw historical bars, while the runtime `set` path pushes bars through `parseCandleData`. Confirm both produce the same bar object shape (they both come from the broker's bar format) so a seeded window and a live-appended window are homogeneous.

## Technical notes

- Symbol/timeframe come from the backtest config (`symbols`, `interval`), exactly like the indicator keys — the node's own fields are usually unresolved templates at init time.
- Seeding writes a real `RollingWindow` instance, which is what the executor's `set` path expects and what `get` reads. `dataContext.setData` returns a `DataRef`; ignore the return value.
- Observation (not part of this change): the indicator warmup keys use `runId` (line 430) while the session runs under `effectiveRunId`; in manual mode those differ. Rolling-window seeding uses `effectiveRunId` so it matches run time. Say the word if you want the indicator keys aligned too.
- No change to `IndicatorsExecutor`, the `/storage/rolling-window` manual route, or the key format.

## Verification

- Backtest with `BacktestInit -> ... -> RollingWindow (set)` and `size < warmup_period`: first bar returns `isReady: true`, `count: size`.
- `RollingWindow (get)` for the same symbol/timeframe returns the seeded window before any `set` runs.
- Multi-symbol run: `rolling_windows_initialized` equals the symbol count.
- Live `InitializeIndicators` node output is unchanged (rolling-window entries skipped).
