# ATR Indicator — End-to-End Implementation Plan

Both attached documents are sound and consistent with the codebase: ATR belongs in the existing generic indicator framework, with no dedicated executor. The LEAN recommendation doc's calculation change (first-bar TR = high - low, readiness at `period` bars) is valid and is now folded in below.

## Verified against the code

- `InitializeIndicatorsExecutor.ts:40` already lists `"ATR"` in `INDICATOR_NAMES` — discovery/warm-up wiring is genuinely already in place.
- `IndicatorsExecutor` derives the type from `node.name.toLowerCase()`, so `ATR` maps to `atr` with no registry change.
- `requiredWarmupBars()` (`indicatorStateManager.ts:61-94`) has no `atr` case and falls through to `1`.
- `IndicatorService.createIncrementalUpdater()` (`indicators.ts:216`) and `IndicatorService.calculate()` (`indicators.ts:2040`) have no `atr` case.
- `routes/indicators.ts` has no `/atr` route.
- Frontend: `src/utils/indicatorRegistry.ts` has no `atr` spec; `src/utils/visualizeNormalize.ts:3` `OSCILLATOR_NAMES` has no `atr`; `src/nodes/Visualize.json` indicator picker has no `atr` option.

## Corrections to the documents

1. **Seeding follows LEAN, not ADX — warm-up is `period`.** The LEAN recommendation doc supersedes my earlier `period + 1` note, and it is right: LEAN's `AverageTrueRange` counts the first valid bar as True Range #1 using `high - low`, so ATR(14) is ready on bar 14. Use `case "atr": return positivePeriod(params.period);`. `count` means valid True Range observations, not bars. This differs from ADX's updater (which burns bar 1 to seed `prevHigh/prevLow/prevClose`); that divergence is intentional and should be commented in the code so nobody "fixes" it later.
2. **Do not use `technicalindicators`' `ATR.calculate` for the batch path.** Its initialization differs and would break the parity rule. Implement one shared `trueRange()` + `updateAtrState()` pair; `computeATRSeries()` (batch) and the incremental `update()` both call it, so parity holds by construction.
3. **No manifest edit is needed.** `src/nodes/manifest.ts` auto-discovers `./*.json` via `import.meta.glob`, so dropping in `ATR.json` is enough — but it must pass `NodeConfigSchema`, and there is **no `public/assets/icons/atr.svg`**. Use `/assets/icons/indicators.svg` rather than pointing at a missing file.
4. **Visualization needs three edits, not one.** Beyond `indicatorRegistry.ts`, add `atr` to `OSCILLATOR_NAMES` in `visualizeNormalize.ts:3` (so it renders in its own panel, not on the price pane) and add the `{ "id": "atr", "name": "ATR" }` option to the picker list in `src/nodes/Visualize.json`.
5. **Explicitly Wilder, v1 only.** LEAN's `QCAlgorithm.ATR(...)` can default to Simple smoothing; we hardcode Wilder (`alpha = 1/period`) so comparisons are deterministic. No moving-average-type field in this PR.
6. **Skip the rest of LEAN's model.** No event-chain indicator objects, no partial pre-ready values (Coreza returns `null` until ready even though LEAN exposes a partial smoother value), no decimal/Big.js arithmetic — plain `number` with a tight comparison tolerance.

Also: the first doc's "Consolidator -> If -> ATR" test row assumes explicit If gating. That is a separate in-flight change; write the test against whatever routing semantics are current at merge time and do not couple this PR to it.


## Math (LEAN-aligned)

```text
TR_t = max(high - low, |high - prevClose|, |low - prevClose|)
TR_1 = high_1 - low_1                       (no previous close)
seed = (TR_1 + ... + TR_period) / period    (ready at bar `period`)
ATR_t = ((ATR_(t-1) * (period - 1)) + TR_t) / period
```

Value is `null` until `count === period`. Deterministic ATR(3) fixture from the doc — bars (10/8/9), (12/9/11), (13/10/10.5), (12/7/8) → TR 2, 3, 3, 5; seed ATR₃ = 2.666667; ATR₄ = 3.444444.

## Changes

**Backend**

1. `coreza-backend/src/nodes/logic/indicators.ts`
   - Add module-level `trueRange(high, low, prevClose)` (returns `high - low` when `prevClose` is not finite) and `updateAtrState(state, bar)` implementing the transition below; then `computeATRSeries(bars, period)` on top of it.
   - State shape: `{ period, prevClose, count, trSum, atr, lastValue }`, where `count` = valid TR observations.
   - Transition: non-finite high/low/close → return `state.lastValue ?? null` and mutate **nothing**. Otherwise compute TR, set `prevClose`, then while `count < period` accumulate `trSum`/`count` and return `null` until `count === period`, at which point `atr = trSum / period`; afterwards apply Wilder recurrence.
   - Add `case "atr"` to `createIncrementalUpdater()`: `warmUp()` folds bars oldest→newest through `updateAtrState`, `update()` calls it once (O(1)).
   - Add `static async calculateATR(input)` validating `period > 0` and candle numerics, returning through `createSuccessOutput({ ... nodeName: "ATR" })`.
   - Add `case "atr": return this.calculateATR(input);` to `calculate()`.
2. `coreza-backend/src/engine/indicatorStateManager.ts` — add `case "atr": return positivePeriod(params.period);`.
3. `coreza-backend/src/routes/indicators.ts` — add `POST /atr` using `executeIndicatorWithState("atr", req, IndicatorService.calculateATR)`.
4. `coreza-backend/src/nodes/logic/toolDefinitions.ts` — add an `ATR` entry mirroring the existing `ADX` entry so the AI Agent can call it. Confirm `ToolExecutor`/`AIAgentExecutor` route indicators generically; only touch them if ADX is special-cased there.

**Frontend**

5. `src/nodes/ATR.json` — modelled on `ADX.json`: fields `candle_data`, `symbol`, `timeframe`, `period` (default `14`), action `POST /indicators/atr`, category `Indicators`, existing icon path.
6. `src/utils/indicatorRegistry.ts` — add `"atr"` to `IndicatorTypeId` and an `atr` spec: `pane: "panel"`, `kind: "line"`, one channel `{ key: "value", label: "ATR", color: "#f97316" }`.
7. `src/utils/visualizeNormalize.ts` — add `"atr"` to `OSCILLATOR_NAMES`.
8. `src/nodes/Visualize.json` — add the ATR picker option.

## Tests — `coreza-backend/tests/atrIndicator.test.ts`

- ATR(3) fixture above → exact seed `2.666667` and next value `3.444444`.
- Fewer than `period` valid bars → `value === null`, `isReady === false`.
- First bar → TR = `high - low`, `count` becomes 1, value `null` (unless `period === 1`).
- Exactly `period` valid bars → seed equals mean of TR₁..TR_period.
- Bar after readiness → exact Wilder recurrence.
- Gap-up and gap-down bars → TR uses the previous close.
- Normal inside bar → TR equals `high - low`.
- `period = 0` / negative / non-numeric → validation error from both batch and updater.
- Malformed OHLC bar → state completely unchanged (`prevClose`, `count`, `trSum`, `atr`), previous value retained, no NaN.
- Parity: `calculateATR(bars)` === `warmUp(bars)` === `warmUp(bars[0..n-2]) + update(last)`.
- `updateSync` vs async `update` produce identical state and value.
- Duplicate timestamp → no double update; out-of-order timestamp → no state mutation (both enforced at the state-manager/route layer, not inside the formula helper).
- `InitializeIndicators` discovers an `ATR` node and warms it with `period` bars.

## Verification

- `tsgo` typecheck + backend jest (`atrIndicator`, indicator parity, warm-up suites).
- Manual: run an ATR node against fetched daily candles and compare the last value against a reference ATR(14) to ~1e-6.
- Confirm the ATR node renders in the palette and plots in its own visualization panel.
