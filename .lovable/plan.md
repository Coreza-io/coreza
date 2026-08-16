# Add Start/End Date to Schwab Get Price History

## Current state (verified)

`coreza-backend/src/brokers/schwab/http/operations.ts` → `get_price_history` sends only `symbol`, `periodType`, `period`, `frequencyType`, `frequency`, `needExtendedHoursData`. The Schwab `/pricehistory` API also accepts `startDate` and `endDate` as **epoch milliseconds**, and when they are supplied `period` must be omitted. `src/nodes/Schwab.json` likewise exposes no date fields for this operation, so backtests can only pull rolling periods.

## Plan

1. **Node UI (`src/nodes/Schwab.json`).** Add a `date_mode` select (`period` | `range`, default `period`) shown for `get_price_history`, mirroring the YahooFinance node's pattern. Show `period`/`periodType` only when `date_mode = period`; add `start_date` and `end_date` text fields (placeholder `2023-01-01` or `{{ $('BacktestInit').json.start_date }}`) shown only when `date_mode = range`.

2. **Operation params (`schwab/http/operations.ts`).** In `get_price_history.makeParams`:
   - always send `symbol`, `periodType`, `frequencyType`, `frequency`, `needExtendedHoursData`;
   - when `start_date`/`startDate` or `end_date`/`endDate` is present, convert each to epoch ms (accept `YYYY-MM-DD`, ISO strings and numeric epochs; reject unparseable values with a clear error) and send `startDate`/`endDate` **instead of** `period`;
   - otherwise keep the existing `period` behaviour unchanged.

3. **Historical data path.** `HistoricalDataService.fetchRange` already sends `start`/`end` for `get_candle`. Add a Schwab `get_candle` alias (or map `start`/`end` inside `get_price_history`) so warm-up and backtest range fetches through Schwab honour the same date window instead of silently falling back to a rolling period — otherwise backtests would still get the wrong bars.

4. **Result shape.** Keep `transformResult` as-is (`{ symbol, candles, empty }`); if the `get_candle` alias is added, wrap it with `toBarSeries(symbol, interval, bars)` so Schwab matches the `BarSeries` contract every other broker returns.

5. **Tests.** New `coreza-backend/tests/schwabPriceHistory.test.ts`: `period` mode unchanged; range mode emits epoch-ms `startDate`/`endDate` and drops `period`; invalid date string errors; `get_candle` returns `BarSeries`.

## Technical details

Files touched:
- `src/nodes/Schwab.json` — `date_mode`, `start_date`, `end_date` fields + `displayOptions`.
- `coreza-backend/src/brokers/schwab/http/operations.ts` — date handling and optional `get_candle` alias.
- `coreza-backend/tests/schwabPriceHistory.test.ts` — new.

No schema or auth changes.
