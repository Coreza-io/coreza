# Remove the dead "Current Bar Data" field from the Backtest Trade node

## Finding (verified)

`current_bar` is **not used** by the Backtest Trade node's `place_order` path:

- `coreza-backend/src/backtest/BacktestExecutor.ts` lines 833-846: the old `current_bar` parse block is commented out and replaced by the note "market data is symbol-scoped inside SimBroker; callers must NOT inject a bar for pricing (that was the cross-symbol pricing defect)". The subsequent `simBroker.placeOrder({...})` call passes only symbol, side, order type, quantity, limit/stop price.
- The `liquidate` branch of the same executor also never reads `params.current_bar`.
- `coreza-backend/src/routes/backtest.ts` lines 225 and 256 still destructure `current_bar` from the body and forward it into `values`, where nothing consumes it.
- The only real consumer is `update_mtm`, on a different node: `BacktestExecutor.ts` lines 1170-1196 (`parseBar(params.current_bar)` / `toMarketBarEnvelope`), reached through `src/nodes/BacktestPortfolio.json` line 52 and `/portfolio` (`routes/portfolio.ts` line 59).

So the field in `src/nodes/BacktestTrade.json` (lines 167-180) is a leftover from the pre-symbol-scoped pricing design. Leaving it invites users to inject a bar for pricing — exactly the cross-symbol defect that was fixed — and it renders under `place_order`, which is the operation where it is most misleading.

## Change

1. `src/nodes/BacktestTrade.json`
   - Delete the `current_bar` field object (lines 167-180) including the trailing comma handling on the preceding `stop_price` field.
   - Reduce `size.height` from 360 to about 320 to match the shorter form.
2. `coreza-backend/src/routes/backtest.ts` (`POST /trade`)
   - Drop `current_bar` from the request destructure (line 225) and from the `values` object (line 256). No validation change — it was always optional and unused.

## Explicitly unchanged

- `src/nodes/BacktestPortfolio.json` keeps its `current_bar` field — `update_mtm` genuinely needs it.
- `routes/portfolio.ts` and the `update_mtm` branch of `BacktestExecutor.ts` are untouched.
- No change to `SimBroker` pricing: it continues to price from the symbol's own market state fed via `onBar`.

## Backward compatibility

Existing saved workflows may still hold a `current_bar` value on a Backtest Trade node. Because the field disappears from the node definition, the visibility-aware serializer stops persisting it and the backend ignores it if still sent, so old workflows keep running with no migration.

## Verification

- Open a workflow with a Backtest Trade node: `place_order` shows Symbol / Side / Quantity / Order Type / Limit / Stop only; `liquidate` shows Symbol only.
- Run a backtest that places market and limit orders and confirm fills, `market_data_symbol`, and `market_data_age_ms` in the node output are unchanged from before the edit.
- Confirm the Backtest Portfolio node's `update_mtm` still accepts and applies `current_bar`.
