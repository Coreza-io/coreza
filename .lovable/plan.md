# Backtest Portfolio node: drop `current_bar` / `prices` pricing injection

## Analysis (verified in code)

**SimBroker already marks positions to market on every bar, for every symbol.**
`simBroker/index.ts` line 574, at the end of `onBar()`: `this.updatePositionMTM(symbol, bar.close)` — and line 969 does the same on each fill. `BacktestSession` feeds one envelope per symbol per timestamp (`alignMultiSymbolBars` fill-forwards symbols that have no new bar), so by the time any Portfolio node runs on that bar, `position.currentPrice`, `marketValue`, and `unrealizedPnl` are already current.

**What the Portfolio node does today is therefore redundant — and unsafe.**
`BacktestExecutor.executeBacktestPortfolio` (lines 1169-1186) reads `params.current_bar` / `params.prices` and, before any read operation (`get_portfolio`, `get_position`, `update_mtm`, `get_equity`), does one of:

- `simBroker.updateAllPositionsMTM(prices)` — overwrites marks from a user-supplied price map, with no symbol or staleness validation.
- `simBroker.onBar(toMarketBarEnvelope(symbol, params.current_bar))` — this is the serious one. It does not merely re-price: `onBar` mutates that symbol's `SymbolMarketState` (`latestRealBar`, `previousRealBar`, `latestEventTimestamp`), **and runs the pending-ticket fill loop for the symbol**. A user-pasted or stale bar wired into a read node can fill resting limit/stop orders out of band, off a bar the session never emitted, and corrupt the causality state that `isCausallyEligible` and `classifyMarketData` depend on. The envelope is built with no `eventTimestamp`, so it also rewinds/advances the symbol clock to the pasted bar's own time.

This is the same defect class that was just removed from the Backtest Trade node ("callers must NOT inject a bar for pricing"). The Portfolio node is the remaining hole.

**`update_mtm` is already a no-op.** `portfolioUpdateMTM` (lines 1290-1302) only validates that `prices` or `symbol + current_bar` was supplied and then returns `portfolioGetAll(simBroker)` — the comment says "MTM was already applied in the main dispatch path". Remove the injection and the operation is exactly `get_portfolio`.

Conclusion: neither `current_bar` nor `prices` is needed on the Portfolio node any more.

## Change

1. `src/nodes/BacktestPortfolio.json`
   - Delete the `current_bar` field (lines 51-63).
   - Remove the `update_mtm` option from the `operation` select (line 32) and drop `"update_mtm"` from the `symbol` field's `displayOptions.show.operation` (line 47), leaving `["get_position"]`.
   - Update the node `description` to drop "and update".
   - Reduce `size.height` from 320 to about 260.
2. `coreza-backend/src/backtest/BacktestExecutor.ts`
   - In `executeBacktestPortfolio`: delete `const currentBar = parseBar(params.current_bar)`, `const prices = parsePrices(params.prices)`, and the whole pre-read MTM injection block (lines 1169-1186). Keep `symbol`.
   - Delete the `case "update_mtm"` branch and the `portfolioUpdateMTM` method.
   - Drop the now-unused `parseBar` / `parsePrices` imports if nothing else in the file uses them (`parseBar` is likely still used elsewhere — check before removing).
3. `coreza-backend/src/routes/backtest.ts` (`POST /backtest/portfolio`, lines 316-327)
   - Stop destructuring and forwarding `current_bar` and `prices`; pass `{ backtest_id, operation, symbol }`.
4. `coreza-backend/src/routes/portfolio.ts`
   - Leave `current_bar` in the zod schema and `update_mtm` in `portfolioOperationSchema` alone: that route serves the **live/broker** `Portfolio` node backed by `PortfolioManager`, which has no bar stream and genuinely needs an external price for MTM. This change is backtest-only.

## Backward compatibility

Saved workflows may still hold `current_bar`/`prices` values or `operation: "update_mtm"` on a Backtest Portfolio node. Removing the field stops it being serialized going forward, and the backend ignores unknown keys. A saved `update_mtm` would fall through to `Unknown portfolio operation` — to avoid breaking existing workflows, keep a silent alias in the switch: map `"update_mtm"` to `portfolioGetAll` without any validation or injection.

## Verification

- Run a multi-symbol backtest with an open position and read `get_portfolio` / `get_position` mid-run: `current_price`, `market_value`, and `unrealized_pnl` must match the current bar's close with no `current_bar` wired in.
- Place a resting limit order, then execute a Portfolio read on the same bar: the order must stay pending (previously an injected bar could fill it).
- Confirm the live Portfolio node's `update_mtm` on `/portfolio` still works unchanged.
