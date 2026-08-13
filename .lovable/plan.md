# BacktestInit: Warm Up Rolling Windows (reuse the indicator warmup path)

## Goal

`BacktestInit` already discovers downstream indicators and warms them from the warmup slice of bars. Reuse that same discovery + per-symbol loop to also seed downstream `RollingWindow` buffers, so the first strategy bar sees a ready window.

## Why RollingWindow can't just be an indicator

`IndicatorStateManager.warmUp()` calls `IndicatorService.createIncrementalUpdater(indicator, params)` and stores an `IndicatorState`. `RollingWindow` has no updater; at run time `IndicatorsExecutor.executeRollingWindowNode` reads its window from the shared `DataContext` under `buildExecutionScopedKey({ userId, workflowId, runId, scope: "rolling_window", parts: [symbol, timeframe] })`. So we reuse the *discovery walk and warmup loop*; only the "how to warm" leaf differs.

## Review of the suggestions — what is adopted

Adopted: (1) generic `discoverWarmupNodes` + filter so the live `InitializeIndicators` output is genuinely unchanged; (2) seed only `operation: "set"` nodes; (3) explicit handling of conflicting sizes; (4) reseeding after `BacktestSession.reset()` — verified: `reset()` calls `this.run.destroy()`, which calls `DataContextManager.destroyContext(executionId)`, so a seeded window would be lost; (5) unique-window count via a key set; (6) aligning indicator keys onto `effectiveRunId`.

Adjusted: for conflicting sizes, take the **minimal-change option** — reject the configuration with a clear error, not add `nodeId` to the key. The node-agnostic `symbol:timeframe` key is a deliberate design decision (locked in by `tests/executionKey.rollingWindow.test.ts`, which asserts two node ids produce the same key) and lets `get` on one node read what another node's `set` wrote. Adding `nodeId` would break that contract.

Deferred: LEAN-style pre-start warmup bars (fetch extra bars before `start_date` instead of consuming the selected range). That is a real semantic gap, but it changes the historical fetch, the bar-alignment, and every existing backtest's results — a separate change, not folded in here.

## End-to-end review of what is already implemented (verified)

Done and correct on the backend:
- `discoverWarmupNodes` + `discoverIndicators` wrapper in `InitializeIndicatorsExecutor.ts` (matches `ROLLINGWINDOW`, filters it out for the live path).
- `BacktestExecutor.executeBacktestInit` splits `discoveredIndicators` / `discoveredWindows`, filters on `operation === "set"`, resolves size via `resolveRollingWindowSeedSize` and errors on conflicts.
- Shared `backtest/rollingWindowSeed.ts` used by both the executor and `BacktestSession.reset()` re-seed, wired through `BacktestSessionManager`.
- Indicator and window keys both on `effectiveRunId`.

Remaining defect: the payload the editor sends, below.

## Root cause of the empty `params` you are seeing (verified)

`discoverWarmupNodes` returns `params: {}` for every RollingWindow node because the frontend never sends their values. In `src/hooks/useNodeExecution.ts` (lines 277-291), when the executed node is `InitializeIndicators` or `BacktestInit`, the whole graph is serialized but values are attached **only** for indicator nodes:

```ts
if (nodeDefinition?.category === "Indicators") {
  serializedNode.values = n.data?.values || {};
}
```

`RollingWindow.json` has `"category": "Data"`, so its `size`, `operation`, `symbol`, and `timeframe` are stripped. The backend's `node.values || node.data?.values` fallback then resolves to `{}` — which is why every discovered window shows `params: {}`, why the `operation === "set"` filter keeps `get` nodes (the `?? "set"` default), and why `clampWindowSize` silently returns 20.

### 0. Fix the serialization — `src/hooks/useNodeExecution.ts`

Widen the condition so warmup-relevant nodes keep their values:

```ts
if (
  nodeDefinition?.category === "Indicators" ||
  nodeDefinition?.name === "RollingWindow"
) {
  serializedNode.values = n.data?.values || {};
}
```

Note this only affects the manual editor run. In the live/scheduled path the nodes come from the DB with `values` intact, so backend-only fixes would never have surfaced this.

Backend hardening for the same class of bug: treat a RollingWindow node whose `params` is empty as a configuration error at init (`"RollingWindow node <id> has no configuration; re-save the workflow"`) instead of silently seeding a default-size window.

## Changes

### 1. `src/nodes/executors/InitializeIndicatorsExecutor.ts`

- Rename the BFS to `discoverWarmupNodes(startNodeId, allNodes, allEdges)`, matching `INDICATOR_NAMES` **or** `ROLLINGWINDOW`, returning the same `{ nodeId, type, params }` shape (`type: "rollingwindow"` for windows).
- Keep `discoverIndicators` as a thin wrapper: `discoverWarmupNodes(...).filter(n => n.type !== "rollingwindow")`. Every existing caller (the executor itself, `POST /indicators/initialize`) keeps identical behavior — same `indicators_total`, same "No indicator nodes found downstream" path for a rolling-window-only workflow.

### 2. `src/backtest/BacktestExecutor.ts`

- **Run id alignment:** move `const effectiveRunId = context?.runId || \`manual-${backtestId}\`;` above the warmup block and use it for the indicator keys too, replacing the current `runId` (`context.runId || context.workflowSessionId || workflowId`). This fixes the existing manual-mode mismatch where indicator state was written under a key the session never reads. Same value then flows into the rolling-window keys, `BacktestSessionManager.createSession`, and the `DataContext`.
- Call `discoverWarmupNodes(...)` once; split into `discoveredIndicators` (unchanged use) and `discoveredWindows = warmupNodes.filter(n => n.type === "rollingwindow" && String(n.params?.operation ?? "set").toLowerCase() === "set")`. `get` nodes are never seeded — they only consume what a `set` node defines.
- **Size conflict check**, before seeding: group `discoveredWindows` by their resolved size (`clampWindowSize(params.size)`). Since all windows for a `symbol:timeframe` share one key, more than one distinct size is a configuration error — return `createErrorOutput("Conflicting RollingWindow sizes (…) for the same symbol/timeframe. All RollingWindow set nodes in a backtest must declare the same Window Size.")`. This matches runtime behavior, where `IndicatorsExecutor` recreates the window whenever `window.size !== size`.
- **Seeding helper** — add a module-level `export function seedRollingWindows({ userId, workflowId, executionId, symbols, interval, size, warmupBarsBySymbol }): number` in `BacktestExecutor.ts` (or a small `backtest/rollingWindowSeed.ts` so `BacktestSession` can import it without a cycle). It:
  - resolves `DataContextManager.getInstance().getContext({ executionId, workflowId, userId })`,
  - for each symbol with non-empty warmup bars: builds the key with `buildExecutionScopedKey({ userId, workflowId, runId: executionId, scope: "rolling_window", parts: [normalizeSymbol(symbol), normalizeTimeframe(interval)] })`, creates `new RollingWindow(size)`, adds the last `size` warmup bars in order, `dataContext.setData(key, window)`, and records the key in a `Set`,
  - returns `keys.size`.
- Call it after the indicator warmup loop and before `BacktestSessionManager.createSession(...)`, and pass the seed inputs (`size`, `warmupBarsBySymbol`, `symbols`, `interval`) into `createSession` so the session can replay them.

### 3. `src/backtest/session/BacktestSession.ts` — survive `reset()`

- Accept an optional `rollingWindowSeed` payload (`{ size, interval, symbols, warmupBarsBySymbol }`) in `createSession` / the constructor and keep it on the instance.
- In `reset()`, after `this.run = this.plan.createRun({...})` (which recreates the `DataContext`), call `seedRollingWindows({ ...seed, userId, workflowId, executionId: this.executionId })` again. Skip when no seed was provided.
- Same for `cleanup()`: nothing to do — the session is going away.

### 4. Output + docs

- `BacktestInit` success `data` gains `rolling_windows_initialized` (the `Set` size — unique `symbol:timeframe` windows, not attempts) and `rolling_window_size` when at least one window was seeded.
- `src/nodes/RollingWindow.json`: in the `size` description, note that in a backtest the window is pre-seeded from `BacktestInit`'s warmup bars, and that all `set` nodes sharing a symbol/timeframe must declare the same size.

## Technical notes

- New imports needed in `BacktestExecutor.ts`: `RollingWindow` (`../engine/RollingWindow`), `clampWindowSize` / `normalizeSymbol` / `normalizeTimeframe` (`../engine/rollingWindowHelpers` — use that exact filename, not `../engine/rollingWindow`, to avoid the earlier case-collision bug), `buildExecutionScopedKey` (`../utils/executionKey`), `DataContextManager` (`../engine/DataContext`).
- Symbol/timeframe come from the backtest config (`symbols`, `interval`), exactly like the indicator keys — the node's own fields are usually unresolved templates at init time.
- `clampWindowSize` falls back to 20 for an unresolved `{{ ... }}` size; log a warning when the raw value isn't numeric so a template mistake is visible.
- `RollingWindow`'s constructor throws outside 1..500; `clampWindowSize` clamps first, so construction is safe.
- Confirm during implementation that seeded raw historical bars have the same shape as bars pushed at run time through `parseCandleData`, so a seeded window and a live-appended window stay homogeneous.
- No change to `IndicatorsExecutor`, the `/storage/rolling-window` manual route, or the key format.

## Verification

- Backtest with `BacktestInit -> ... -> RollingWindow (set)` and `size < warmup_period`: first bar returns `isReady: true`, `count: size`.
- `RollingWindow (get)` for the same symbol/timeframe returns the seeded window before any `set` runs.
- Multi-symbol run: `rolling_windows_initialized` equals the symbol count; running twice does not double-count.
- Reset then re-run: the window is ready again on the first bar (regression test for the `DataContext` destroy).
- Two `set` nodes with different sizes on the same symbol/timeframe: `BacktestInit` fails with the configuration error.
- A `get`-only workflow seeds nothing and reports `rolling_windows_initialized: 0`.
- Live `InitializeIndicators` node and `POST /indicators/initialize` output byte-identical to today for an indicator-only workflow, and still report "No indicator nodes found downstream" for a rolling-window-only workflow.
