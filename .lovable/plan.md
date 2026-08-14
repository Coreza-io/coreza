# Fix: Rolling Window read returns nothing even though the key matches

## What the code shows (verified reads)

Keys now match, so the failure is on the **write** side / lifecycle, not the key builder. Three concrete gaps exist:

1. **No seeding at all in `workflow_replay` warm-up.** `BacktestExecutor` builds
   `rollingWindowSeed = warmupMode === "workflow_replay" || size === undefined ? undefined : {...}`,
   so with replay warm-up `seedRollingWindows` never runs and `rollingWindowsInitialized = 0`. Nothing is ever put in the DataContext at init; the window only appears if a RollingWindow `set` node actually executes during replay.

2. **Silent fallback when `dataContext` is missing.** In `IndicatorsExecutor` the rolling-window `set` branch does:
   ```ts
   if (dataContext) { ...getDataByKey/setData... } else { window = new RollingWindow(size); }
   ```
   When the executor is invoked without `dataContext` (manual single-node execution from the editor, and any engine path that does not thread it), the window is built, filled, returned as payload, and **thrown away**. A later `get` then legitimately finds nothing. The `get` branch has the same blind spot: it reads `dataContext?.getDataByKey(...)` and returns an empty payload instead of an explicit error.

3. **Manual `set` through the route vs. engine `set`.** The `/storage/rolling-window` route and `IndicatorsExecutor` must both write into the same `DataContext` instance for the same `executionId`; any path that still writes elsewhere (or writes nothing, per point 2) produces exactly the observed symptom.

`InMemoryStore` stores by reference with no TTL and evicts only on the 256MB cap, and `cleanupStaleContexts` never deletes contexts — so expiry/eviction is not the cause.

## Plan

1. **Instrument first (one run, then remove).** In the storage `get` branch, log `executionId`, `storeKey`, `dataContext.listDataRefs().map(r => r.ref)`. This immediately distinguishes "context empty" (nothing was written) from "context has other keys" (residual key mismatch). Keep the `getExistingContext` 404 as-is.

2. **Never drop a rolling window write.** Remove the `else { new RollingWindow(size) }` silent path in `IndicatorsExecutor`. When no `dataContext` is available, resolve one through `DataContextManager.getInstance().getContext({ executionId, workflowId, userId })` using the same ids used to build the key, so a `set` is always persisted into the shared store.

3. **Make a missing window explicit on `get`.** In both `IndicatorsExecutor` and the storage route, when the key is absent return a clear error/flag (`ready: false`, `reason: "no window for <symbol>/<timeframe> in this execution"`) instead of an empty-but-successful payload, so this class of bug surfaces instead of looking like an empty buffer.

4. **Seed rolling windows in replay warm-up too.** Rolling windows are plain FIFO buffers with no side effects, so the `warmupMode === "workflow_replay"` exclusion is unnecessary and is what leaves the buffer empty until enough live bars arrive. Build `rollingWindowSeed` whenever `rollingWindowSize` is defined, and keep passing it to `BacktestSessionManager.createSession` so `session.reset()` re-seeds identically. Replay then only tops the pre-seeded window up.

5. **Regression test.** Extend `coreza-backend/tests/rollingWindowOperations.test.ts`: a `set` executed without an injected `dataContext` must be readable afterwards through the storage-route key path for the same `executionId`; and a `get` for an unseeded symbol must return the explicit not-found shape.

## Technical details

Files touched:
- `coreza-backend/src/nodes/executors/IndicatorsExecutor.ts` — resolve `DataContext` when absent (both `get` and `set` branches), explicit not-found on `get`.
- `coreza-backend/src/backtest/BacktestExecutor.ts` — drop the `workflow_replay` exclusion when building `rollingWindowSeed` (line ~501).
- `coreza-backend/src/routes/storage.ts` — temporary diagnostic log, explicit not-found response shape.
- `coreza-backend/tests/rollingWindowOperations.test.ts` — new cases.

No frontend or schema changes.
