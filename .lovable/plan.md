# Consolidator end-to-end review

## Confirmed working

- `TimeBarConsolidator` implements left-closed/right-open buckets, timezone + anchor alignment, Monday alignment for weekly, duplicate detection and out-of-order rejection.
- `consolidatorShared.ts` is the single source of truth for the state key (`symbol:source:target:timezone:anchor`) and the step, used by both `ConsolidatorExecutor` and the route — manual and engine runs cannot drift apart.
- `POST /storage/consolidator` resolves the canonical `executionId` (`runId ?? workflowSessionId ?? backtestId`), reads/writes state through the same `DataContext` the engine uses, and returns `{ emitted, bar, workingBar }` with `meta.key`.
- `Consolidator.json` now points at `/storage/consolidator`; the executor suppresses downstream while a bucket is still building.

## Open items to verify and fix

1. **Frontend must send an execution id.** The route 404s ("Execution context not found") without `runId`/`workflowSessionId`/`backtestId`. Confirm `useNodeExecution` includes the session id in the Consolidator payload, exactly as it does for Rolling Window; add it if missing.
2. **Executor state fallback divergence.** `ConsolidatorExecutor` falls back to `context.getState/setState` when no `DataContext` exists, while the route only uses `DataContext`. A manual run right after an engine run without a context would silently start a fresh bucket. Make both paths read the same store, or return an explicit error instead of starting a new bucket.
3. **Warm-up seeding.** Check `ConsolidatorWarmup` writes its state under the exact key from `buildConsolidatorStateKey` (same normalized timeframes, timezone default `UTC`, empty anchor), otherwise backtests start unwarmed while reporting `rolling_windows_initialized`-style success.
4. **Partial final bucket.** By design no flush happens at the end of a backtest, so the last incomplete bar is dropped. Confirm this is intended; if not, add an explicit finalize step in `BacktestExecutor`.

## Verification

- Editor: five 1h bars into a 1h→4h consolidator — first four `emitted:false`, fifth `emitted:true` with correct OHLCV.
- Backtest with warm-up: first live bucket continues the warmed bucket instead of restarting.
- Existing `consolidatorRoute.test.ts` / `consolidatorWarmup.test.ts` extended for the key-parity and missing-context cases.
