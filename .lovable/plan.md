# Indicator output and readiness contract — reviewed implementation plan (ATR first)

## Review of the attached ATR plan

The attached plan is technically sound and matches the code today. Confirmed by reading the sources:

- `coreza-backend/src/nodes/logic/indicators.ts` has a dedicated ATR kernel (`period`, `smoothing`, `prevClose`, `count`, `trSum`, Simple TR window, `atr`, `lastValue`) plus `migrateAtrState`/`isAtrState`. Wilder and Simple both exist.
- `updateAtrState` returns `null` until `period` samples, so no provisional value and no True Range are exposed.
- `calculateATR` returns an array of numbers/nulls; `routes/indicators.ts` returns a one-item array of `{currentValue, previousValue}` for **every** indicator; `IndicatorsExecutor` exposes the same two fields from cached state.
- The existing test file asserts warm-up nulls, so it changes with the contract.

### Corrections and improvements to the attached plan

1. **Do not drop the batch series.** The attached plan swaps `calculateATR`'s array for a snapshot; charts need history. Keep the series and add the snapshot beside it.
2. **Additive output instead of a contract version flag.** Emit new fields alongside existing `currentValue`/`previousValue` for one release, so saved workflows keep working. Remove the old pair only after a consumer audit.
3. **Zero is a valid ready value.** Node help must tell authors to gate on readiness, never on a non-zero value.
4. **Verify before rebuilding idempotency.** Duplicate and older timestamps already fail to advance state; extend that behaviour to new fields rather than re-implementing.
5. **Lean-pinned parity fixtures, chart rework and AI schema edits are follow-ups**, not part of the first change.

## Scope change: this applies to all indicators, not only ATR

The attached plan is ATR-only, but the gaps it names — no provisional warm-up value, no readiness flag, previous reset to `null`, state advancing on rejected input, differing shapes between batch/cached/route paths — are shared by every indicator that flows through the same kernel, state manager, executor and route. So the plan below defines **one shared contract and one shared set of state rules for all indicators**, then applies it indicator by indicator, with ATR as the first and reference implementation.

## Shared indicator contract

Every indicator returns an object inside `data`, with these common fields:

```json
{
  "success": true,
  "status": "success",
  "data": {
    "IsReady": true,
    "SampleCount": 37,
    "Current": 6.444444444444445,
    "Previous": 6.666666666666667,
    "currentValue": 6.444444444444445,
    "previousValue": 6.666666666666667
  }
}
```

- `IsReady` (boolean) and `SampleCount` (integer) are **mandatory on every indicator**.
- `Current` and `Previous` are the primary scalar values. For multi-channel indicators they are objects holding that indicator's channels, matching the existing channel keys in `src/utils/indicatorRegistry.ts`:
  - MACD: `{ macd, signal, histogram }`
  - Bollinger: `{ upper, middle, lower }`
  - ADX: `{ adx, pdi, mdi }`
  - Stochastic: `{ k, d }`
  - Ichimoku: `{ conversion, base, spanA, spanB }`
  - RSI, EMA, SMA, ATR, VWAP, OBV, Volume Oscillator: plain numbers
  - Support & Resistance keeps its level arrays under `Current`
- Indicator-specific extras sit beside these. ATR adds `TrueRange` (number).
- Before any accepted sample, numeric fields are `0` (or channel objects of zeros), `IsReady` is `false`, `SampleCount` is `0`. No nulls.
- `currentValue`/`previousValue` remain for one release for backward compatibility.
- The same shape is returned by batch, cached, stateful route, stateless fallback, live and backtest paths. The batch path additionally returns the full historical series in `meta` so charts keep their history.

## Shared readiness and state rules

- Readiness is derived from **accepted sample count vs. the indicator's required sample count**, never from array length and never from a non-null value.
- `warmupCompleted` stays distinct from `IsReady`: a short warm-up can complete without the indicator being ready.
- Warm-up produces provisional values using the same code path as live updates, so warming up N bars at once equals processing them one at a time — including `Previous`.
- `Previous` is the value from the preceding accepted sample, `0` (or zeros) before one exists; it is never reset to `null` after warm-up.
- A bar is validated **before** any mutation. Rejected input advances nothing: not the value, not the count, not `lastBarTime`.
- Identical timestamps are idempotent; older timestamps do not advance state. Corrections require explicit replay.
- Every path uses one timestamp normalisation helper; no per-value guessing between seconds and milliseconds.
- Persisted state carries a calculation-state version. On reload, a version or parameter mismatch rebuilds rather than exposing stale values.

## ATR calculation specifics

- First accepted bar: `TR = high - low`. Later: `TR = max(high - low, abs(high - prevClose), abs(low - prevClose))`; store `prevClose` only after computing TR.
- With period `n` and accepted count `k`: `k <= n` both modes return the mean of the TR observations so far; `k > n` Wilder uses `prev + (TR - prev) / n` and Simple uses the mean of the latest `n` TR values.
- `IsReady = k >= n`. Period 1 is ready on the first bar, where ATR equals TR.
- Reject before mutating: missing, null, empty, boolean or non-finite prices, `high < low`, close outside the bar range. Non-empty finite numeric strings stay supported.

## Implementation

**1. Shared types and formatter** — `coreza-backend/src/nodes/logic/indicators.ts`
Add an exported `IndicatorOutput` base type (`IsReady`, `SampleCount`, `Current`, `Previous`) and a single `toIndicatorOutput(indicatorType, state)` formatter used by batch, executor and route. ATR extends it with `TrueRange`.

**2. Kernel changes, indicator by indicator** — same file
Each incremental updater returns an explicit accepted flag, keeps a `previous` value, and reports accepted count and required sample count. ATR additionally stores `previousAtr` and `trueRange`; capture the old current value before computing, then commit previous/current/TR/prevClose/count together. Keep full precision in state; round only for display.

**3. Validation and acceptance** — same file
One shared pre-mutation validator for price/bar input, extended per indicator for what it needs (close-only vs. OHLC vs. volume). Validate a whole batch before processing so a bad bar cannot leave state half-advanced.

**4. State manager** — `coreza-backend/src/engine/indicatorStateManager.ts`
Initialise every indicator with zeros, `IsReady: false`, `SampleCount: 0`. After warm-up copy current, previous, accepted count and last accepted timestamp from the kernel instead of resetting previous to `null`. Advance outer state only on an accepted update. Share one apply helper between `update` and `updateSync`. Persist everything needed to return an unchanged snapshot after a restart.

**5. Executor and route** — `IndicatorsExecutor.ts`, `routes/indicators.ts`
`executeIndicatorWithState` already receives `indicatorType`; use it to pick the formatter and return the same object in the new-bar, cached and fallback branches for all thirteen endpoints. Process every unseen bar in order, not only the latest. Validate parameters even when cached state exists.

**6. Node help** — `src/nodes/ATR.json` first, then the other indicator JSONs
Describe outputs and state plainly that `IsReady` must be checked before use, since `0` is a valid ready value. No new nodes or handles.

**Follow-ups:** chart adapters mapping `Current` to candle time, AI tool guidance in `toolDefinitions.ts`, Lean-pinned parity fixtures, and retiring `currentValue`/`previousValue` after a consumer audit.

## Rollout order

1. ATR: shared types, formatter, kernel, state, executor, route, tests — the reference implementation.
2. Single-value indicators: RSI, EMA, SMA, VWAP, OBV, Volume Oscillator.
3. Multi-channel indicators: MACD, Bollinger, ADX, Stochastic, Ichimoku.
4. Support & Resistance, which keeps its level-array shape under the shared envelope.
5. Node help, chart and AI follow-ups.

Each stage ships with its own tests, and stages 2 to 4 must not change the fields already shipped in stage 1.

## ATR acceptance fixture

Period 3, bars `(high, low, close)`: `(105,100,103)`, `(110,104,108)`, `(109,101,102)`, `(106,100,105)`.

| After bar | TrueRange | Wilder Current | Wilder Previous | Simple Current | Simple Previous | IsReady |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| none | 0 | 0 | 0 | 0 | 0 | false |
| 1 | 5 | 5 | 0 | 5 | 0 | false |
| 2 | 7 | 6 | 5 | 6 | 5 | false |
| 3 | 8 | 6.666666667 | 6 | 6.666666667 | 6 | true |
| 4 | 6 | 6.444444444 | 6.666666667 | 7 | 6.666666667 | true |

Warming up all four bars at once must give the same `Previous` as one-at-a-time processing.

## Tests

Extend `coreza-backend/tests/atrIndicator.test.ts` (keeping its gap, alias, smoothing, period-validation, discovery and isolation coverage, replacing the warm-up null assertions), and add a **shared contract suite parameterised over every indicator**:

- Exact envelope: `IsReady` boolean, `SampleCount` integer, `Current`/`Previous` present with the right channel keys, exact capitalization.
- Empty/reset snapshot is all zeros and not ready; readiness boundary at `n-1`, `n`, `n+1`.
- Batch, full warm-up, split warm-up, async and sync updates all agree; the batch series is unchanged.
- Repeated and older bars return an identical snapshot and advance nothing.
- Several unseen bars equal ordered single-bar updates.
- Invalid input leaves inner and outer state untouched.
- Flat/zero-range input: a ready value of `0` survives output normalization and `false` is not coerced.
- Redis round-trip matches uninterrupted execution; version or parameter mismatch rebuilds.
- Multiple symbols, nodes and runs stay isolated.
- Route, executor and cached paths return the same shape for all thirteen endpoints.

ATR-specific: the fixture above for both smoothing modes after every bar, plus period 1 ready on the first bar.

## Verification

Run the backend Jest suites for ATR, the shared contract suite, the indicator state manager, the executor and the indicator routes, plus frontend node validation, reading the full output. Then confirm in the editor that an ATR node shows all its fields and that `{{ $('ATR').json.data.IsReady }}` resolves as a boolean in an IF node.

## Backend repository note

This work lives in the separated `coreza-io/coreza-backend` repository and must be copied across manually, as usual.

## Done when

Every indicator returns `IsReady` and `SampleCount` with values in a consistent shape across batch, cached, route, live and backtest paths; warm-up produces provisional numbers instead of nulls; readiness comes from accepted sample count; rejected input and repeated deliveries never advance state; restarts preserve state; chart series still work; and existing `currentValue`/`previousValue` consumers keep running.
