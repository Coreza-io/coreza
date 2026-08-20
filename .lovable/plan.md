# Fix "route not found" when running the Consolidator node manually

## Cause

`src/nodes/Consolidator.json` declares `"action": { "url": "/workflow/execute", "method": "POST" }`, which is not a manual single-node route, so the editor request 404s. Nodes that keep engine state route to the storage service instead — `RollingWindow.json` uses `/storage/rolling-window`.

## Fix — route it exactly like Rolling Window

1. **Add `/storage/consolidator`** in the same storage route module that serves `/storage/rolling-window`, following that handler step for step: resolve the canonical `executionId` (`runId ?? workflowSessionId ?? backtestId`), get the existing `DataContext`, build the state key, run the step, write the state back.
2. **Share the key builder and step logic** the same way rolling window shares `rollingWindowShared.ts`: `ConsolidatorExecutor` and the route both call one helper that builds `symbol:source:target:timezone:anchor` and runs `TimeBarConsolidator`, so manual and engine runs can never drift onto different keys.
3. **Point the node at it**: set `Consolidator.json` `action.url` to `/storage/consolidator`.
4. **Same response shape as the executor**: `success: true` with `{ emitted, bar, workingBar }`; a still-building bucket is not an error. Missing execution context returns the same 404-style payload rolling window returns, with the resolved key in `meta` for debugging.

## Verification

- Manual run in the editor: no route error; four 1h inputs return `emitted: false`, the fifth returns `emitted: true` with the completed 4h bar.
- Manual run and backtest run resolve the same `executionId` and the same working bucket.
- Route test covering held vs emitted responses, missing context, and the invalid-timeframe error.
