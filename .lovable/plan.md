# ATR four-field output — reviewed implementation plan

## Review of the attached plan

The attached plan is technically sound and matches the code as it stands today. Confirmed by reading the current sources:

- `indicators.ts` holds a dedicated ATR kernel with `period`, `smoothing`, `prevClose`, `count`, `trSum`, a Simple TR window, `atr`, `lastValue`, plus `migrateAtrState` and `isAtrState`. Wilder and Simple both exist and are validated.
- `updateAtrState` returns `null` until `period` observations, so no provisional value and no True Range are exposed today.
- `calculateATR` returns an array of numbers/nulls; the stateful route returns only `currentValue`/`previousValue`; `IndicatorsExecutor` exposes the same two fields from cached state.
- The current test suite explicitly asserts warm-up nulls, so it must be updated alongside the contract.

So the plan's gap table is accurate and its calculation and readiness rules match Lean's ATR semantics. I would adopt it with the following corrections.

### Corrections and improvements

1. **Do not drop the batch series.** The plan replaces `calculateATR`'s array with a single snapshot. Charting depends on history, and a snapshot cannot rebuild an ATR line. Keep the full series and add the snapshot beside it rather than swapping one for the other.
2. **Prefer additive output over a contract version flag.** Rather than a versioned serializer plus migration machinery, emit the four new fields alongside the existing `currentValue`/`previousValue` for one release. Existing saved workflows keep working untouched, and the old pair is removed only after an audit. This removes the risk of version selection being derived from cache presence.
3. **`Previous: 0` needs an explicit warning in the node help, not only the plan.** A zero previous value is indistinguishable from a real flat reading, so the UI text must tell authors to gate on `IsReady` and, where two mature readings matter, to hold readiness downstream.
4. **Verify before rebuilding idempotency.** Current tests already show duplicate and older timestamps not advancing state. Treat that as a behavior to confirm and extend to the new fields, not as new work.
5. **Scope down the first change.** Lean-pinned parity fixtures, chart-adapter rework, AI tool-schema edits and workflow migration tooling are follow-ups. The first change is the kernel, the snapshot, the state manager, the executor, the route and tests.
6. **Field naming.** The PascalCase keys are unlike the rest of Coreza, but they match the requested contract and Lean, so keep them and treat the capitalization as part of the contract asserted by tests.

## Output contract

```json
{
  "success": true,
  "status": "success",
  "data": {
    "Current": 6.444444444444445,
    "Previous": 6.666666666666667,
    "TrueRange": 6,
    "IsReady": true,
    "currentValue": 6.444444444444445,
    "previousValue": 6.666666666666667
  }
}
```

- Fresh, reset, or valid-but-empty input: `Current`, `Previous`, `TrueRange` are `0` and `IsReady` is `false`.
- Missing `candle_data` stays a validation error; a short valid batch is a success with provisional values and `IsReady: false`.
- The batch path additionally returns the existing ATR series in `meta`, so charts keep their history.
- The same object shape is returned by batch, cached, live, backtest and stateless fallback paths.

## Calculation and readiness

- First accepted bar: `TR = high - low`. Later bars: `TR = max(high - low, abs(high - prevClose), abs(low - prevClose))`; store `prevClose` only after computing TR.
- With period `n` and accepted count `k`:
  - `k < n`: both modes return the mean of all TR observations so far (provisional).
  - `k = n`: both modes return the mean of the first `n` TR observations.
  - `k > n`: Wilder uses `prev + (TR - prev) / n`; Simple uses the mean of the latest `n` TR values.
- `IsReady = k >= n`. For period 1 the first bar is ready and ATR equals TR.
- `Previous` is the ATR from the preceding accepted bar, `0` before one exists. It may be provisional on the first ready bar.
- A ready ATR can legitimately be `0`; readiness must never be inferred from the value.

## Implementation

**1. Snapshot type and formatter** — `coreza-backend/src/nodes/logic/indicators.ts`
Add an exported `AtrOutput` type and a single pure `toAtrOutput(state)` used by every ATR path. No renaming of other indicators' internals.

**2. ATR kernel** — same file
Add `previousAtr` and `trueRange` to the ATR state, initialise public numbers to `0`, and bump the ATR state version so stale persisted state is rebuilt rather than silently reused. On each accepted bar, capture the old current value first, compute TR, update the count and the smoother, then commit previous/current/TR/prevClose/count together. Return an explicit accepted flag. Keep full precision in state; rounding is presentation only.

**3. Validation and acceptance**
Reject before mutating: missing, null, empty, boolean, non-finite prices, `high < low`, and a close outside the bar range. Keep numeric-string support for non-empty finite strings only. Validate a whole batch before processing it so a bad bar cannot leave state half-advanced. A rejected bar never counts as a sample and never advances timestamps.

**4. State manager** — `coreza-backend/src/engine/indicatorStateManager.ts`
Initialise ATR with zeros and `IsReady: false`; after warm-up copy current, previous, TR, accepted count and last accepted timestamp from the kernel instead of resetting previous to `null`. Derive readiness from accepted count, keep `warmupCompleted` separate from readiness, share one apply helper between `update` and `updateSync`, and persist everything needed to return an unchanged snapshot after a restart. Advance outer state only on an accepted update.

**5. Executor and route** — `IndicatorsExecutor.ts`, `routes/indicators.ts`
Use the shared formatter in the stateful branch, the cached branch and the stateless fallback, so all three return the same object. Process every unseen bar in order rather than only the latest. Validate parameters even when cached state exists.

**6. Node help** — `src/nodes/ATR.json`
Describe both smoothing options and the four outputs, and state plainly that `IsReady` must be checked before using ATR, since `0` is a valid ready value. No new node or handle.

**Follow-ups, not part of this change:** chart adapter mapping of `Current` to candle time, AI tool guidance, Lean-pinned parity fixtures, and retiring `currentValue`/`previousValue` after a consumer audit.

## Acceptance fixture

Period 3, bars `(high, low, close)`: `(105,100,103)`, `(110,104,108)`, `(109,101,102)`, `(106,100,105)`.

| After bar | TrueRange | Wilder Current | Wilder Previous | Simple Current | Simple Previous | IsReady |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| none | 0 | 0 | 0 | 0 | 0 | false |
| 1 | 5 | 5 | 0 | 5 | 0 | false |
| 2 | 7 | 6 | 5 | 6 | 5 | false |
| 3 | 8 | 6.666666667 | 6 | 6.666666667 | 6 | true |
| 4 | 6 | 6.444444444 | 6.666666667 | 7 | 6.666666667 | true |

Warming up all four bars at once must produce the same `Previous` as processing them one at a time.

## Tests

Extend `coreza-backend/tests/atrIndicator.test.ts`, keeping its existing gap, alias, smoothing, period-validation, discovery and isolation coverage, and replacing the warm-up null assertions.

- Exact four-field schema: three finite numbers plus a boolean, exact capitalization.
- Empty/reset snapshot, and period 1 ready on the first bar.
- Readiness boundary at `n-1`, `n`, `n+1`, with correct provisional values and `Previous`.
- The fixture above, both smoothing modes, after every bar.
- Batch, full warm-up, split warm-up, async and sync updates all agree; the batch series is unchanged.
- Repeated and older bars return an identical snapshot and do not advance count, previous or timestamps.
- Several unseen bars equal ordered single-bar updates.
- Invalid bars leave inner and outer state untouched.
- Zero-range bars: a ready ATR of `0` survives output normalization, and `false` is not coerced.
- Redis round-trip: a restored snapshot and the next update match uninterrupted execution; a state-version or parameter mismatch rebuilds rather than reusing stale values.
- Multiple symbols, nodes and runs stay isolated.
- Route, executor and cached paths return the same shape; other indicators are unchanged.

## Verification

Run the backend Jest suites for ATR, the indicator state manager, the executor and the indicator routes, plus frontend node validation, and read full output. Then confirm in the editor that an ATR node shows all four fields and that `{{ $('ATR').json.data.IsReady }}` resolves as a boolean in an IF node.

## Backend repository note

This work is in the separated `coreza-io/coreza-backend` repository and must be copied across manually, as usual.

## Done when

Every ATR execution path returns `Current`, `Previous`, `TrueRange` and `IsReady` with matching values, warm-up produces provisional numbers instead of nulls, readiness comes from accepted sample count, restarts and repeated deliveries preserve state, the chart series still works, and existing `currentValue`/`previousValue` consumers keep running.
