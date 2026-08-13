# BacktestInit: Warm Up Rolling Windows (mirroring indicator warmup)

## Goal

`BacktestInit` already warms up every downstream indicator from the warmup slice of bars. Downstream `RollingWindow` nodes are not warmed, so the first strategy bars run against an empty window. Add rolling-window seeding using the exact same shape as the indicator warmup — same discovery helper style, same per-symbol loop, same warmup slice — with the smallest possible diff.

## How indicators do it today (verified)

In `coreza-backend/src/backtest/BacktestExecutor.ts` (`executeBacktestInit`):

1. `discoverIndicators(node.id, allNodes, allEdges)` — BFS over downstream edges, filtered by `INDICATOR_NAMES` (lines 384-391).
2. Bars sliced into `warmupBarsBySymbol` / `remainingBarsBySymbol` (lines 393-406).
3. One loop `for (const currentSymbol of symbols)` × `for (const ind of discoveredIndicators)` that builds a key from `(userId, workflowId, runId, currentSymbol, interval, nodeId)` and calls `stateManager.warmUp(...)` (lines 408-445).

At run time `IndicatorsExecutor.executeRollingWindowNode` reads/writes the window in the shared `DataContext` under
`buildExecutionScopedKey({ userId, workflowId, runId, scope: "rolling_window", parts: [normalizeSymbol(symbol), normalizeTimeframe(timeframe)] })`,
and the session's `DataContext` / `runId` is `effectiveRunId` (`context.runId || manual-<backtestId>`).

## Changes (minimal, three files)

### 1. `src/nodes/executors/InitializeIndicatorsExecutor.ts`

Mirror `discoverIndicators` exactly — do not refactor it. Add one small exported function next to it:

```ts
export function discoverRollingWindows(startNodeId, allNodes, allEdges): { nodeId: string; params: Record<string, any> }[]
```

Same BFS body, matching normalized node name `ROLLINGWINDOW` instead of `INDICATOR_NAMES`. (Duplicating ~20 lines of BFS keeps the indicator path untouched; no generic `discoverDownstreamNodes` refactor.)

### 2. `src/backtest/BacktestExecutor.ts`

- Move the existing `const effectiveRunId = context?.runId || \`manual-${backtestId}\`;` (line 482) above the warmup block, so seeding uses the same run id the session's `DataContext` will use. `isManual` stays where it is.
- Next to `discoverIndicators`, add `const discoveredWindows = allNodes.length > 0 ? discoverRollingWindows(node.id, allNodes, allEdges) : [];`
- Immediately after the indicator warmup loop, add a mirrored block guarded the same way (`discoveredWindows.length > 0 && some warmup bars`):
  - Resolve the context once: `const dataContext = DataContextManager.getInstance().getContext({ executionId: effectiveRunId, workflowId, userId })`.
  - `const windowSize = Math.max(...discoveredWindows.map(w => clampWindowSize(w.params?.size)))` — all nodes on the same `symbol:timeframe` share one window key, so the largest declared size wins.
  - `for (const currentSymbol of symbols)`: build the key with `buildExecutionScopedKey({ userId, workflowId, runId: effectiveRunId, scope: "rolling_window", parts: [normalizeSymbol(currentSymbol), normalizeTimeframe(interval)] })`, create `new RollingWindow(windowSize)`, push the last `windowSize` warmup bars in order, `dataContext.setData(key, window)`, count it.

Seeding happens before `BacktestSessionManager.createSession(...)`, so the first strategy bar already sees a ready window.

### 3. Output + docs

- Add `rolling_windows_initialized` (count) to the `BacktestInit` success `data` block, alongside the existing fields.
- `src/nodes/RollingWindow.json`: note in the `size` description that in backtests the window is pre-seeded from `BacktestInit` warmup bars.

## Technical notes

- Symbol/timeframe come from the backtest config (`symbols`, `interval`) exactly like the indicator warmup keys — never from the rolling-window node's own fields, which are usually unresolved templates at init time.
- Seeding writes a real `RollingWindow` instance, which is what the executor's `set` path expects; it only re-creates the window when `window.size !== size`, hence taking the max size.
- Observation (not part of this change): the indicator warmup keys use `runId` (line 430), while the session runs under `effectiveRunId`. In manual mode those differ. The rolling-window seeding deliberately uses `effectiveRunId` so it matches run time. Say the word if you also want the indicator keys aligned.
- No change to `IndicatorsExecutor`, the `/storage/rolling-window` manual route, or the key format.

## Verification

- Backtest with `BacktestInit -> ... -> RollingWindow (set)` and `size < warmup_period`: first bar returns `isReady: true`, `count: size`.
- `RollingWindow (get)` for the same symbol/timeframe returns the seeded window before any `set` runs.
- Multi-symbol run: `rolling_windows_initialized` equals the symbol count.
- Workflow with no `RollingWindow` node behaves exactly as today.
