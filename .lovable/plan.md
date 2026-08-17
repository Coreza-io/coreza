# Portfolio `get_position`: always return an array

Today the response shape differs by input: a single `position` object when a symbol is given, and a collection when the symbol field is blank. Downstream nodes then need two different reference paths.

## Change

Make `get_position` always return `positions` as an array:

- Symbol given, position open: array with one entry.
- Symbol given, no position: empty array.
- Symbol blank: array with every open position (unchanged data, array shape).

Keep `has_position` as a boolean (true when the array is non-empty) and add `count`.

## Technical details

- Update the `get_position` handler in the backtest path (`coreza-backend/src/nodes/executors/PortfolioExecutor.ts` / SimBroker portfolio read) and the live path (`PortfolioManager.ts`) so both build the same array payload through one shared shaping helper — no per-mode divergence.
- Preserve the existing per-position fields (symbol, side, quantity, avgFillPrice, currentPrice, unrealizedPnl, realizedPnl, marketValue, openCostBasis).
- Update the Portfolio node JSON `output` sample so the editor preview and reference picker suggest `positions[0]...`.
- Keep `position` as a deprecated alias (first element, or null) for one release so existing workflows referencing `data.position` don't break; note it in the field description.

## Verification

Run the portfolio executor tests, plus a backtest with a symbol, without a symbol, and with a symbol that has no open position, confirming all three return an array.
