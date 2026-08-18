# BacktestInit (Alpaca): "Bar Adjustment = split" appears to have no effect

The node exposes `adjustment` (default raw, shown for Alpaca + stock), but the returned bars look unadjusted. Where the value is lost is unconfirmed, so step 1 traces it.

## Step 1 — Trace the value along the whole path

Log/inspect `adjustment` at each hop and find the first one where it is missing:

1. Frontend serialization of BacktestInit values sent to `/backtest/init`.
2. The backtest init route/executor building the historical fetch request.
3. `HistoricalDataService` fetch options for the Alpaca provider.
4. The final Alpaca `get_candle` params (the operation already supports and validates `adjustment`, defaulting to `raw`).

Also confirm the warm-up fetch carries the same value, so strategy and pre-start bars aren't mixed adjustments.

## Step 2 — Fix at the first broken hop

- Value never leaves the node: include `adjustment` in the serialized BacktestInit payload.
- Value dropped server-side: thread it through the init request into `HistoricalDataService` options and into the Alpaca params builder for both strategy and warm-up fetches.
- Value passed but overridden: remove the hardcoded `raw` default on the backtest path so the user selection wins.

## Step 3 — Make it visible and verified

- Echo the effective `adjustment` in the BacktestInit output `data` block (next to `bars_fetched` / `warmup_bars_used`) so the setting is auditable in the UI.
- Add a test asserting a BacktestInit with `adjustment: "split"` reaches the Alpaca candle params as `split` for both strategy and warm-up ranges.
- Manually verify against a symbol with a known split in the date range: split-adjusted closes differ from raw.

## Technical details

Touches the BacktestInit serialization in the frontend node execution hook, the backtest init handler, `HistoricalDataService`, and the Alpaca `get_candle` params builder. No change to the adjustment validation already covered by `tests/alpacaCandleAdjustment.test.ts`.
