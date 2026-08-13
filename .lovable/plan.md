# Get Position: return all positions when symbol is empty

Today in backtest mode, `get_position` errors with `'symbol' is required for get_position` when the Symbol field is blank. Broker mode already returns all positions when no symbol is given. This change brings backtest mode to the same behaviour.

## Behaviour

- Symbol provided: unchanged single-position response (`has_position`, `quantity`, `unrealized_pnl`, etc.).
- Symbol blank: return every open position for the backtest, plus a count, instead of an error.

## Technical changes

1. `coreza-backend/src/backtest/BacktestExecutor.ts` — `portfolioGetPosition`
   - Replace the `if (!symbol) return leanError(...)` guard with an all-positions branch: read `simBroker.getPortfolioState().positions`, map through `formatPositionWithPnlPercent`, attach `realized_pnl` per symbol from `realizedPnlBySymbol`, and return `{ has_position, positions, positions_count }`.
   - Keep the existing single-symbol return shape untouched.

2. `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` — `backtestGetPosition`
   - Same change, mirroring the shape used by `brokerGetPosition` (`positions`, `positions_count`) so live and backtest outputs align.

3. `src/nodes/Portfolio.json` and `src/nodes/BacktestPortfolio.json`
   - Symbol field for `get_position`: keep it optional (it is already `required: false` in Portfolio.json; set `required: false` in BacktestPortfolio.json) and update the description/placeholder to note "leave blank for all positions".

No changes to MTM, order, or trade logic.
