# Fix: Rolling Window key mismatch between manual storage route and BacktestExecutor

## The problem (verified)

Three different execution scopes are used for the same rolling-window buffer:

| Path | executionId used | Storage |
|---|---|---|
| `routes/storage.ts` (manual RollingWindow node) | `workflowSessionId` | local `rollingWindows` Map in the route file |
| `BacktestExecutor` warm-up seeding (`rollingWindowSeed.ts`) | `context?.runId \|\| backtestId` | `DataContextManager` context |
| `IndicatorsExecutor` (RollingWindow node in engine runs) | `context.runId` | `DataContext` |

The backtest engine and the indicators executor already agree (both use `context.runId`). The real break is the storage route: different identifier **and** a completely separate store. So swapping `workflowSessionId` for `backtestId` in the route would not fix anything — the stores still differ.

## Decision on the reviewed suggestion

The suggestion is valid and adopted: standardize on one canonical `executionId` for all stateful data, keep `backtestId` strictly for DB records / SimBroker / results, add a non-creating `getExistingContext`, and return `execution_id` from BacktestInit.

One addition on top of it: include `workflowSessionId` in the executor's fallback chain so manual editor runs converge with **zero frontend change** (the RollingWindow node already sends `workflowSessionId`, and `/backtest/init` already receives it). Returning `execution_id` still happens, so the client can pin the scope explicitly later.

## Plan

1. **Canonical execution identity.** In `BacktestExecutor`, rename `effectiveRunId` to `executionId` and resolve it as
   `context?.runId ?? context?.workflowSessionId ?? backtestId`
   (same precedence `HistoricalDataService` already uses). Add `workflowSessionId?: string` to the executor's context type. This id drives indicator keys, rolling-window keys, `DataContext`, `BacktestSession`, node state, and reset/cleanup. `backtestId` stays for the DB row, SimBroker lookup, progress and results.

2. **Non-creating context lookup.** Add to `DataContextManager`:
   `getExistingContext(executionId: string): DataContext | undefined { return this.contexts.get(executionId); }`
   Reads must never lazily create an empty context — that would hide an id mismatch behind an "empty window" result.

3. **Storage route uses the same DataContext.** In `routes/storage.ts`:
   - accept `executionId` from the body, falling back to `workflowSessionId` (legacy); 400 when neither is present.
   - delete the module-level `rollingWindows` Map, `sessionKeys` and `touchSession` (the DataContext manager already expires stale contexts).
   - `get`: `getExistingContext(executionId)`; 404 `"Execution context not found or already completed"` when absent; otherwise `dataContext.getDataByKey(storeKey)`.
   - `set`: `getContext({ executionId, workflowId, userId })`, reuse the stored window and replace it only when the declared `size` changed, then `setData(storeKey, window)`.
   - key building is unchanged apart from passing the resolved `executionId`.

4. **Expose the id.** Add `execution_id: executionId` alongside `backtest_id` in the BacktestInit output so the client can pass it back when inspecting rolling-window state.

## Technical details

Files touched:
- `coreza-backend/src/backtest/BacktestExecutor.ts` — rename + fallback chain (line ~325), context type widening, `execution_id` in the init payload.
- `coreza-backend/src/engine/DataContext.ts` — add `getExistingContext`.
- `coreza-backend/src/routes/storage.ts` — remove the local map/LRU, resolve `executionId`, route both branches through `DataContext`.
- Tests: extend `coreza-backend/tests/rollingWindowOperations.test.ts` with a case asserting a window seeded via `seedRollingWindows({ executionId })` is readable through the storage-route key path, and that an unknown `executionId` yields the 404 branch rather than an empty window.

No frontend changes required; `execution_id` is additive.
