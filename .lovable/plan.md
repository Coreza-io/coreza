# ATR: selectable smoothing method (LEAN-style)

The current ATR is hardcoded to Wilder. This adds an explicit smoothing choice, matching LEAN's design: True Range is fixed, the moving average over it is configurable.

The document's analysis is correct and matches LEAN. One design decision to carry over: **never rely on a default**. LEAN's inconsistency (`new AverageTrueRange(14)` → Wilders, `ATR(symbol, 14)` → Simple) is exactly the trap to avoid, so Coreza will have a single explicit value everywhere, defaulting to `wilders` in one place only (parameter parsing) and stamping the resolved method into state and output.

## Current implementation (verified)

- `indicators.ts:134-243` — `AtrState`, `parseAtrPeriod`, `parseAtrBar`, `isAtrState`, `trueRange`, `updateAtrState`, `createAtrState`, `computeATRSeries`. Wilder only, first bar TR = high − low, ready at `period`.
- `indicators.ts:333-356` — `case "atr"` incremental updater.
- `indicators.ts:1737-1758` — `calculateATR`, returns the full series.
- `indicatorStateManager.ts:78-79` — `case "atr": return positivePeriod(params.period);`.
- `routes/indicators.ts:217` — `POST /indicators/atr`.
- Frontend: `src/nodes/ATR.json`, `indicatorRegistry.ts:96`, `visualizeNormalize.ts:3`, `Visualize.json:80`.

## Scope

Support **`wilders` (default) and `simple`** in v1. Both are the only methods with real ATR meaning, and the shared state shape stays small. The state field is a string, not a boolean, so `exponential` and others can be added later without another migration.

## Changes

### 1. `coreza-backend/src/nodes/logic/indicators.ts`

- Add `type AtrSmoothing = "wilders" | "simple";` and `parseAtrSmoothing(value: unknown): AtrSmoothing` — trims, lowercases, accepts `wilder`/`wilders` and `simple`/`sma` as aliases, treats empty/undefined as `"wilders"`, throws a 400 on anything else. No silent fallback for unknown strings.
- Extend `AtrState` with `smoothing: AtrSmoothing` and `trWindow: number[]` (used only by `simple`; stays empty for `wilders`).
- `createAtrState(period, smoothing)` seeds both fields.
- `isAtrState` validates `smoothing` is one of the two values and `trWindow` is a finite-number array. **Backward compatibility:** a persisted state missing `smoothing` is treated as `wilders` with an empty window rather than rejected, so existing Redis/L1 indicator states survive the deploy.
- `updateAtrState` keeps the shared TR computation and the invalid-bar early return (no mutation), then branches:
  - `wilders` — unchanged arithmetic.
  - `simple` — push `tr` onto `trWindow`; while `trWindow.length > period` shift; `count += 1`; return `null` until `count >= period`; then `atr = sum(trWindow) / period`. Keep a running `trSum` for O(1): `trSum += tr` on push and `trSum -= removed` on shift, so the value is `trSum / period` with no re-summing per bar.
  - Both paths end with `state.lastValue = state.atr`.
- `computeATRSeries(bars, period, smoothing)` passes the method through.
- `case "atr"` in `createIncrementalUpdater` reads `params.smoothing ?? params.smoothing_method ?? params.moving_average_type` through `parseAtrSmoothing` and threads it into `createAtrState`. Because `serializeParams` already sorts all params into the updater cache key, two ATR nodes with different smoothing get distinct cached updaters automatically.
- `calculateATR` parses the smoothing param the same way and passes it to `computeATRSeries`.

### 2. `coreza-backend/src/engine/indicatorStateManager.ts`

`requiredWarmupBars` stays `positivePeriod(params.period)` for both methods — both become ready on the `period`-th valid TR. Add a short comment saying so. `params` already includes `smoothing`, so distinct states are keyed separately by `serializeParams`.

### 3. `coreza-backend/src/routes/indicators.ts`

No route change. The smoothing field arrives in `req.body` and flows through `executeIndicatorWithState` → `calculateATR` / state manager params unchanged.

### 4. `src/nodes/ATR.json`

Add a required select field after `period`:

```json
{
  "key": "smoothing",
  "label": "Smoothing Method",
  "type": "select",
  "default": "wilders",
  "required": true,
  "options": [
    { "value": "wilders", "label": "Wilder (standard ATR)" },
    { "value": "simple", "label": "Simple (rolling average)" }
  ],
  "description": "Moving average applied to True Range. Wilder is the conventional ATR used by most charting platforms; Simple is a strict rolling window."
}
```

Confirm the option shape against `src/nodes/schemas/nodeSchema.ts` and an existing select-bearing node before writing it, and re-run `npx tsx scripts/validate-nodes.ts`.

### 5. `coreza-backend/src/nodes/logic/toolDefinitions.ts`

Update the `ATR` entry: description becomes "Average True Range (ATR) volatility, with selectable Wilder or Simple smoothing", and add the `smoothing` parameter with its enum and default so the AI agent can set it explicitly.

### 6. Frontend visualization

No change needed — the panel spec and picker entry are method-agnostic. Optionally the legend label can show `ATR(14, Wilder)`; skip unless asked.

## Tests — extend `coreza-backend/tests/atrIndicator.test.ts`

Doc's ATR(3) worked example, TR series 2, 3, 4, 10, 2:

| Step | Wilder | Simple |
| --- | --- | --- |
| after TR3 | 3 | 3 |
| after TR4 | 5.333333 | 5.666667 |
| after TR5 | 4.222222 | 5.333333 |

- Both methods, both engines: assert the six values above exactly (tolerance 1e-9).
- Default with no `smoothing` param → identical to explicit `wilders` (regression guard against a silent default flip).
- Unknown `smoothing` value → 400 validation error from both `calculateATR` and `createIncrementalUpdater`; no fallback.
- `simple`: readiness at `period` valid bars; a large TR leaving the window drops the value sharply (the divergence in the table already covers this).
- `simple`: `trWindow` never grows past `period` over 200 bars — guards state size in Redis.
- Invalid OHLC bar under `simple` leaves `trWindow`, `trSum`, `count` and `prevClose` untouched.
- Parity per method: `calculateATR` final === `warmUp(all)` === `warmUp(all−1) + update(last)`; `updateSync` === async `update`.
- Legacy state migration: a persisted state object without `smoothing`/`trWindow` passes `isAtrState` and continues as Wilder with the correct next value.
- Two ATR nodes on the same symbol/timeframe with different smoothing keep separate state and values.

## Verification

- `tsgo` typecheck, `npx tsx scripts/validate-nodes.ts`, backend jest ATR suites. (Note: the local sandbox lacks `ioredis`, so redis-importing suites can fail here for environmental reasons — run them in CI.)
- Manual: same daily candles, run ATR(14) Wilder and Simple side by side; Wilder should match a reference charting ATR(14) to ~1e-6 and Simple should differ after any large TR exits the window.

## Not doing in this PR

`exponential`, `hull`, `t3`, and the rest of LEAN's `MovingAverageType` set. The parameter is a string so they can be added later without changing the state contract.
