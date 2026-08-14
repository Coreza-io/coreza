# Fix: Rolling Window key mismatch between manual storage route and BacktestExecutor

## The problem (verified)

Three different execution scopes are used for the same rolling-window buffer:

| Path | executionId used | Storage |
|---|---|---|
| `routes/storage.ts` (manual RollingWindow node) | `workflowSessionId` | local `rollingWindows` Map in the route file |
| `BacktestExecutor.execute` warm-up seeding (`rollingWindowSeed.ts`) | `context?.runId \|\| backtestId` — and `/backtest/init` never sets `runId`, so it is the freshly created `backtestId` | `DataContextManager` context |
| `IndicatorsExecutor` (RollingWindow node in engine runs) | `context.runId` | `DataContext` |

So in a manual backtest the seeded window is written under `...executionId:<backtestId>` inside a DataContext, while the manual RollingWindow node reads `...executionId:<workflowSessionId>` from a completely separate in-memory Map. The `get` operation always returns an empty window.

## Best solution

Make the manual editor session the single canonical execution scope, and make all readers/writers use one store.

1. **One execution identity for manual runs.** In `BacktestExecutor`, resolve
   `effectiveRunId = context?.runId || context?.workflowSessionId || backtestId`
   (same precedence already used by `HistoricalDataService`). Add `workflowSessionId?: string` to the executor's context type. Live/engine runs keep `runId`; manual runs now scope to `workflowSessionId`, which is exactly the key the storage route uses.

2. **One store.** Replace the module-level `rollingWindows` Map + `sessionKeys` LRU in `routes/storage.ts` with `DataContextManager.getInstance().getContext({ executionId: workflowSessionId, workflowId, userId })` and `getDataByKey` / `setData`. This makes the manual route read exactly the objects `seedRollingWindows` wrote and the ones `IndicatorsExecutor` maintains — no duplicate buffers, no separate eviction policy.

3. **Return the backtest scope to the frontend for reference.** `/backtest/init` response already carries backtest metadata; include `execution_id: effectiveRunId` in the result meta so the editor can confirm which scope the session is bound to (diagnostic only, no behaviour change).

4. **Guard rails.** Keep `workflowSessionId` required on `/storage/rolling-window`; when it is absent the route keeps returning 400 rather than silently creating an orphan scope.

## Technical details

Files touched:
- `coreza-backend/src/backtest/BacktestExecutor.ts` — `effectiveRunId` precedence + context type widening (line ~325).
- `coreza-backend/src/routes/storage.ts` — drop `rollingWindows`/`sessionKeys`/`touchSession`, use `DataContextManager`; both `get` and `set` branches; `set` still reuses/recreates the window when `size` changes.
- `coreza-backend/src/engine/DataContext.ts` — no change expected; contexts already self-expire via `cleanupStaleContexts`, replacing the 200-session LRU.
- Tests: extend `coreza-backend/tests/rollingWindowOperations.test.ts` (or add a small case) asserting that a window seeded with `executionId = workflowSessionId` is readable through the storage-route key builder.

No frontend changes: the RollingWindow node already sends `workflowSessionId`, and `/backtest/init` already receives it.
