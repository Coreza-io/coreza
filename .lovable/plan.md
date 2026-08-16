# Add adjustment (and missing bar params) to Alpaca Get Candle

## Current state (verified)

`coreza-backend/src/brokers/alpaca/http/operations.ts` → `get_candle` sends `symbols`, `timeframe`, `start`, `feed`, `sort`, `limit`, optional `end` and `page_token`. The `adjustment` param is present but **commented out** (line 160), so every stock bars request silently uses Alpaca's default `raw` — split/dividend-adjusted history is unavailable, which skews backtests across splits.

## Plan

1. **Node UI (`src/nodes/Alpaca.json`).** For the Get Candle operation add:
   - `adjustment` — select: Raw / Split / Dividend / Spin-off / All (default `raw`), with a note that values can be combined (`split,spin-off`). Shown only when `asset_type` is not `crypto` (Alpaca crypto bars ignore it).
   - `sort` — select Asc/Desc (currently sent but not user-settable), default `asc`.
   - `currency` — optional text for crypto/latest-bar parity, only if not already present.

2. **Operation params (`alpaca/http/operations.ts`).** In `get_candle.makeParams`:
   - re-enable `adjustment`, sourced from `input.adjustment`, defaulting to `raw`, and **omit it entirely for `asset_type === "crypto"`**;
   - accept comma-separated combinations, trimming whitespace and validating each token against `raw|split|dividend|spin-off|all` with a clear error on an unknown token;
   - keep `sort`/`limit` behaviour unchanged, only defaulting `sort` to `asc` when absent.

3. **Historical/backtest path.** `HistoricalDataService.fetchRange` builds the `get_candle` input; thread `adjustment` through it (from the BacktestInit/broker node values) so warm-up and strategy bars use the same adjustment as manual runs. Without this, manual node output and backtest bars would disagree across a split.

4. **Tests.** New `coreza-backend/tests/alpacaCandleAdjustment.test.ts`: default `raw` for equities; combined `split,spin-off` passes through; unknown token errors; crypto requests omit `adjustment`.

## Technical details

Files touched:
- `src/nodes/Alpaca.json` — new `adjustment` / `sort` fields with `displayOptions`.
- `coreza-backend/src/brokers/alpaca/http/operations.ts` — validated `adjustment`, crypto exclusion, `sort` default.
- `coreza-backend/src/marketData/HistoricalDataService.ts` — pass `adjustment` into the `get_candle` input.
- `coreza-backend/tests/alpacaCandleAdjustment.test.ts` — new.

No schema, auth or frontend logic changes beyond the node definition.
