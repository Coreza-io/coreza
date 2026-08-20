# Fix "route not found" when running the Consolidator node manually

## Cause

`src/nodes/Consolidator.json` declares `"action": { "url": "/workflow/execute", "method": "POST" }`. Every other node points its `action` at a real backend REST route it owns — for example `RollingWindow.json` uses `/storage/rolling-window` and `Compute.json` uses `/comparator/compute`. `/workflow/execute` is not a route the manual single-node run can call, so the editor's execute request 404s with "route not found". The executor itself is fine — this only affects the manual/editor path; workflow and backtest runs go through the executor registry, not the node's `action` URL.

## Fix

1. **Add a backend route** that manually executes one consolidation step, mirroring how the rolling-window route works:
   - `POST /consolidator/consolidate` accepting `candle_data`, `symbol`, `source_timeframe`, `target_timeframe`, `timezone`, `anchor_time`, plus the execution identity the editor already sends.
   - It normalizes the bar with `parseBar`, runs `TimeBarConsolidator`, and persists the working bar in the same execution-scoped store the workflow path uses so a manual run and an engine run share one bucket (resolve the execution id with the existing canonical `runId ?? workflowSessionId ?? backtestId` chain, as rolling-window does).
   - Response mirrors the executor: `{ emitted, bar, workingBar }` with `success: true` while a bucket is still building.
2. **Register the route** in the backend router alongside the other node routes.
3. **Point the node at it**: change `Consolidator.json`'s `action.url` to `/consolidator/consolidate`.
4. **Avoid duplicated logic**: the route and `ConsolidatorExecutor` both call the same `TimeBarConsolidator` and the same state key builder — extract the key builder into the consolidation module so manual and live runs cannot drift (the same problem previously fixed for rolling window with `rollingWindowShared.ts`).

## Verification

- Run the Consolidator node manually in the editor: no 404; four 1h inputs return `emitted: false`, the fifth returns `emitted: true` with the completed 4h bar.
- Confirm the manual run and a backtest run resolve the same execution id and therefore the same working bucket.
- Add a route test covering held vs emitted responses and the invalid-timeframe error path.
