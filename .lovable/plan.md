# Consolidator implementation — review result and remaining checks

## Verified as correctly implemented

- `utils/timeframe.ts`: alias normalization, exact-multiple ratio validation, rejects `3h → 4h`.
- `utils/barParser.ts`: accepts `timestamp|time|t` and long/short OHLCV aliases, rejects non-finite values and numeric-string timestamps handled explicitly.
- `engine/consolidation/TimeBarConsolidator.ts`: left-closed/right-open buckets, boundary input emits the previous bucket and opens the new one (no double count), first-open/max-high/min-low/last-close/summed-volume, idempotent duplicates, `DUPLICATE_BAR_CONFLICT` and `OUT_OF_ORDER_BAR`, timezone/anchor alignment via `date-fns-tz`, Monday alignment for weekly buckets.
- `nodes/executors/ConsolidatorExecutor.ts`: `syncCapable = true`, state via `context.getState/setState` keyed by symbol+source+target+timezone+anchor, held bar returns `success: true` with `suppressDownstream`.
- Routing: `suppressDownstream` on `ControlFlags`, honoured in `engine/executionRuntime.ts` (both routing sites) and `backtest/compiled/vm.ts`.
- Registration: executor in `nodes/index.ts`, `Consolidator: "Consolidator"` in `categoryMap.ts`, `src/nodes/Consolidator.json` present.
- Warm-up sizing: `backtest/warmup/ConsolidatorWarmup.ts` wired into `BacktestExecutor`.
- Tests: `tests/timeBarConsolidator.test.ts` covers boundary, duplicates/conflict/out-of-order, DST, 09:30 anchor, weekly alignment, and executor hold-then-emit.

## Remaining checks to close out

1. **WarmupPolicy**: confirm `Consolidator` is in the explicit execute list so the node runs during `workflow_replay` and its partial bucket carries into the live/strategy phase (trading and portfolio nodes stay rejected).
2. **Frontend serialization**: confirm `src/hooks/useNodeExecution.ts` includes Consolidator values in the BacktestInit graph payload — otherwise `resolveConsolidatorWarmup` sees empty params, exactly like the earlier RollingWindow issue.
3. **Runtime routing test**: add a test asserting a held result activates no successors in the queue runtime and in the compiled VM, and that an emitted one does.
4. **End-to-end backtest**: run 1h source / 4h target and confirm SimBroker still sees every 1h bar while RollingWindow/ATR only receive 4h bars.

## Technical notes

Items 1 and 2 are the only places where a miss would silently degrade behaviour (warm-up would under-fetch and the consolidator would run outside replay). Everything else in the design is in place as specified.
