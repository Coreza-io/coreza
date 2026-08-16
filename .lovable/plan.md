# Fix Schwab price history: derive periodType from frequencyType

## Root cause (verified in `coreza-backend/src/brokers/schwab/http/operations.ts`)

`makePriceHistoryParams` always sets `periodType: input.periodType || 'day'` (line 68) regardless of the chosen `frequencyType`. In Date Range mode the UI hides Period Type, so a `frequencyType=daily` request goes out as `periodType=day + frequencyType=daily`, which Schwab rejects with "When periodType=day valid values for frequencyType are: minute". Nothing in the backend validates the pair, so the bad combination reaches Schwab.

## Plan

1. **Derive a compatible `periodType`** in `makePriceHistoryParams`:
   - normalize `frequencyType` (lowercase, default `minute`);
   - when the caller supplied an explicit `periodType`, keep it (period mode still works, e.g. `month` + `daily`);
   - otherwise derive: `minute -> day`, `daily | weekly | monthly -> year`.

2. **Validate the pair before sending.** Add a small compatibility table and throw a clear Coreza-side error instead of relaying to Schwab:
   - `day` → `minute`
   - `month` → `daily`, `weekly`
   - `year` → `daily`, `weekly`, `monthly`
   - `ytd` → `daily`, `weekly`
   Error message names both values and the allowed set.

3. **Validate `frequency`** against the frequency type (minute: 1/5/10/15/30; daily/weekly/monthly: 1), defaulting to `1`, so an invalid `frequency` also fails locally with a readable message.

4. **Keep `get_candle` behaviour intact.** It already spreads `schwabFrequency(interval)` which supplies an explicit `periodType`, so the derivation must not override it — this is covered by the "explicit wins" rule in step 1.

5. **Fix `needExtendedHoursData`** to use `??` so an explicit `false` boolean is preserved instead of falling back to the string default.

6. **Tests** in `coreza-backend/tests/schwabPriceHistory.test.ts`:
   - Date Range + `daily` (no `periodType`) → `periodType: 'year'`, epoch `startDate`/`endDate`, no `period`;
   - Date Range + `minute` → `periodType: 'day'`;
   - explicit `periodType: 'month'` + `daily` preserved;
   - invalid pair (`periodType: 'day'` + `daily`) throws the local validation error;
   - existing period-mode and `get_candle` assertions still pass.

## Technical details

Single backend file changed: `coreza-backend/src/brokers/schwab/http/operations.ts` (new `derivePeriodType` + `assertFrequencyCompatibility` helpers used by `makePriceHistoryParams`), plus the test file. No node JSON / frontend change is needed — the UI already hides Period Type in Date Range mode, which is the correct behaviour once the backend derives it.
