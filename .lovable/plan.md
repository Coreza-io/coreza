# BacktestInit (Alpaca): "Bar Adjustment = split" never reaches the backend

The debugger on `BacktestExecutor.executeBacktestInit` shows the incoming `params` object contains name, broker, credential_id, asset_type, feed, interval, dates, warmup_period, fill/slippage/commission — but **no `adjustment` key at all**, so `const adjustment = params.adjustment` is `undefined`. The value is lost before the request, not inside the backend.

## Step 1 — Fix the sending side

Find why `adjustment` is omitted from the BacktestInit payload while its sibling `feed` (same node, same conditional display) is included, and fix that:

- Check the node-values serialization used for BacktestInit (visibility-aware serialization in `useNodeFieldState` / `useNodeExecution`): a field is likely being dropped because it is not in the saved-field whitelist or its `displayOptions` visibility is evaluated as hidden at send time.
- Ensure the field is persisted and serialized under exactly the key `adjustment`, matching what `BacktestExecutor` reads.

Re-run and confirm the debugger now shows `adjustment: 'split'` in `params`.

## Step 2 — Thread it through the fetches

With the value arriving, confirm it flows into both fetch paths and is not overridden by a hardcoded `raw`:

- The strategy-range historical fetch (`HistoricalDataService` → Alpaca `get_candle` params).
- The pre-start warm-up fetch, so warm-up and strategy bars use the same adjustment.

Apply a default of `raw` only when the value is absent.

## Step 3 — Make it visible and verified

- Echo the effective `adjustment` in the BacktestInit output `data` block (next to `bars_fetched` / `warmup_bars_used`) so the setting is auditable in the UI.
- Add a test asserting a BacktestInit with `adjustment: "split"` reaches the Alpaca candle params as `split` for both strategy and warm-up ranges.
- Manually verify on a symbol with a split inside the range: adjusted closes differ from raw.

## Technical details

Primary change is frontend field serialization for the BacktestInit node; secondary changes thread the value through `BacktestExecutor` → `HistoricalDataService` → Alpaca `get_candle`. Adjustment-token validation already exists and is covered by `tests/alpacaCandleAdjustment.test.ts`; no change there.
