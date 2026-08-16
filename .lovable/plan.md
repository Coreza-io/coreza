# Fix: RollingWindow `get` finds the context but the store is empty

## What the evidence shows

The debugger screenshot is decisive: the resolved `DataContext` for `563834ae-…` exists but its `InMemoryStore` has `store = Map(0) {size: 0}` and `currentSizeBytes = 0`. So the key is right and the context is right — **nothing was ever written into that context**, or it was cleared after being written.

Two code paths explain that, both verified in source:

1. **Replay warm-up never seeds.** `BacktestExecutor` builds
   `rollingWindowSeed = warmupMode === "workflow_replay" || rollingWindowSize === undefined ? undefined : {...}`.
   With `workflow_replay` warm-up, `seedRollingWindows` is skipped entirely, so at BacktestInit time the context is created but empty. A `get` before any `set` bar has flowed then legitimately returns the not-found payload (`no window for AMD/1Day`).

2. **The `set` side may write into a different store.** `seedRollingWindows` and `BacktestSession` both call `DataContextManager.getContext({ executionId })`, while `session.reset()` calls `this.run.destroy()` and re-seeds only when `this.rollingWindowSeed` is set — which is `undefined` in replay mode. So after any reset in replay mode the context is empty again.

## Plan

1. **Seed rolling windows in every warm-up mode.** Rolling windows are pure FIFO buffers with no side effects, so excluding `workflow_replay` is unnecessary and is the direct cause of the empty store. Build `rollingWindowSeed` whenever `rollingWindowSize` is defined and keep passing it into `createSession`, so both `initialize()` and `reset()` re-seed identically.

2. **Verify the write target once.** Add a temporary log at the end of `seedRollingWindows` printing `executionId`, seeded key count and `dataContext.listDataRefs().map(r => r.ref)`, and one in the storage `get` branch printing the same list for the resolved context. If the two `executionId`s differ, the remaining fix is to thread the same id (`context.runId ?? workflowSessionId ?? backtestId`) into the session; if they match and the list is empty, cause 1 is confirmed. Remove the logs after the run.

3. **Guard the empty-store case in the payload.** Keep the explicit `found: false / reason` response (it is working as designed), but include `availableKeys: dataContext.listDataRefs().length` in `meta` so this class of problem is diagnosable from the node output instead of the debugger.

4. **Test.** Extend `coreza-backend/tests/rollingWindowOperations.test.ts` with a BacktestInit-style case asserting that `warmupMode: "workflow_replay"` still produces a seeded window readable through the storage-route key, and that `session.reset()` restores it.

## Technical details

Files touched:
- `coreza-backend/src/backtest/BacktestExecutor.ts` — drop the `workflow_replay` exclusion when building `rollingWindowSeed` (line ~501).
- `coreza-backend/src/backtest/rollingWindowSeed.ts` — temporary diagnostic log.
- `coreza-backend/src/routes/storage.ts` — `availableKeys` in the not-found `meta`, temporary diagnostic log.
- `coreza-backend/tests/rollingWindowOperations.test.ts` — replay-mode seeding cases.

No frontend or schema changes.
