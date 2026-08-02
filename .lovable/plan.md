# Review: Lean-parity SimBroker corrections + buying-power audit

## Part 1 — End-to-end review of what was implemented

Verified against the code, not the plan text. Everything below is confirmed by reading the files.

**Phase 1 — slippage double-count (P0-001): correct.**
`applyFill` now computes `netPnl = grossPnl - totalCommissionForTrade` (index.ts:707). `totalSlippageForTrade` (:706) is still computed and stored on `Trade.slippage` (:729) as a diagnostic only. The convention comment is at :44. `adjustedPrice = fillResult.price + slippage` (:410, :548), and `SlippageModel` returns a signed value (+ for buy, − for sell), so the adjusted price is genuinely the economic execution price on both sides. Entry-side slippage is carried per-unit in `currentEntryMap` with `Math.abs`, so it never leaks into P&L. Stats aggregation (:954) uses `Math.abs(event.fillQuantity)`, so it survives the signed-quantity change.

**Phase 2 — durable realized P&L (P0-003): correct and fully wired.**
`cumulativeRealizedPnl`, `realizedPnlBySymbol`, `cumulativeFees` are on `PortfolioState` (interfaces.ts:127-129), initialised at :120-122, incremented in `applyFill` at :714-716 **before** the `delete this.state.positions[...]` at :740, and fees at :615. All consumers read the durable field: `PortfolioExecutor.ts` 1017, 1471, 1631, 1689, 1820 and `BacktestExecutor.ts` 1161, 1199, 1281. `simulation/PortfolioManager.getPortfolioState` derives the same three fields from `trades`/`orders`, so live and backtest expose an identical shape.

**Phase 3 — order event / ticket semantics: correct.**
Signed `fillQuantity` with `absoluteFillQuantity` alongside at both fill sites (:444-448, :579-581); `OrderEvent` type updated (types/order.ts:103-104); `BacktestExecutor.ts:840` prefers `absoluteFillQuantity` with an `Math.abs` fallback. `aggregateTicketFill` (:799-818) does a true weighted average and sets `partially_filled` vs `filled`. Both fill paths ask the fill model for `remainingQuantity` only (:377, :517) and clamp with `Math.min(fillResult.quantity, remainingQuantity)`.

**Not implemented, by your decision:** the Phase 0 tests and the `isSynthetic` forward-fill guard. Noted, no action.

**Two loose ends worth knowing about (not blocking):**
- No `eventsSchemaVersion` migration was added. Backtest runs persisted before this change still hold unsigned sell `fillQuantity`. Nothing in `src/` reads `fillQuantity` today, so nothing renders wrong — but any future reader will see mixed sign conventions in old rows.
- `onBar` is unchanged in name and behaviour, as requested; query paths still trigger it.

## Part 2 — Buying-power logic, end to end

Flow today: `placeOrder` → `validateOrder` (checks `cash - reservedCash`, :316) → `reserveBuyingPower` (:820). Release happens on cancel/reject/expire/replace via `transitionPendingOrder` (:232), on full fill (:457, :590), on stale/missing tickets in `onBar` (:367, :372, :381) and on zero-remaining (:521). Partial fills call `adjustBuyingPowerReservation` (:459, :592). `BacktestExecutor.ts:1238` reports `buying_power: state.cash - state.reservedCash`.

The lifecycle is complete — every terminal path releases, and no path reserves twice. The defects are in **how much** is reserved.

### BP-1 (high) — reservation is priced off the wrong symbol
`validateOrder` (:304), `reserveBuyingPower` (:822) and `adjustBuyingPowerReservation` (:838) all read `state.currentBar?.close`. `currentBar` is a single global slot overwritten by whichever symbol's bar was processed last (:350, :358, :541). In any multi-symbol backtest, an AAPL order can be reserved at the last MSFT close. Fix: resolve the price from the order's own symbol — `getSymbolState(symbol).previousBar?.close ?? lastFillPrice`, falling back to the global bar only if the symbol has no data yet.

### BP-2 (high) — worst-case price ignored for limit and stop orders
A buy is always reserved at last close. Lean reserves at the price the order can actually execute at. Fix the estimate to:
- `limit` and `stop_limit` buy → `limitPrice`
- `stop_market` buy → `stopPrice`
- `market` buy → symbol's last close
Today a limit buy resting far below market over-reserves, and a stop-market buy above market under-reserves and can overdraw cash on fill.

### BP-3 (medium) — re-pricing on partial fill lets reservation drift above cash
`adjustBuyingPowerReservation` recomputes the remaining leg at the *current* price. On a rising bar, the reservation for the unfilled remainder grows even though cash already left the account for the filled part, so `reservedCash` can exceed `cash` and block unrelated orders. Fix: store the per-unit reserve rate at placement (`reservedRateByOrderId`) and on each partial fill set `reservation = rate * remainingQuantity`, so the reservation only ever shrinks.

### BP-4 (medium) — shorts reserve nothing
`reserveBuyingPower` returns immediately for `order.side !== "buy"` (:821). With `allowShort: true`, `validateOrder` skips the position check (:327) and there is no margin requirement, so a strategy can open unbounded short exposure. Fix: when `allowShort` is on, reserve `notional * shortMarginRequirement + fee` (default 1.0, configurable on `SimBrokerConfig`) for sells that increase a short, and skip the reservation for sells that close an existing long.

### BP-5 (low) — float drift and orphaned reservations
`reservedCash` is maintained by `+=`/`-=` and clamped with `Math.max(0, ...)` at :855, which hides drift rather than preventing it. Fix: derive `reservedCash` as the sum of `reservationsByOrderId` in a small private recompute called from reserve/adjust/release. Also release all outstanding reservations at backtest finalisation so the final `buying_power` figure isn't understated by orders that never resolved.

### BP-6 (low) — sell-side release is a silent no-op
`releaseBuyingPower` is called for sell orders too and exits on `undefined` (:854). Correct, but once BP-4 lands the same call has real work to do — keep the single release path and let the reserve side decide the amount.

## Implementation order

1. Add a private `estimateOrderPrice(symbol, order)` helper that resolves the symbol's own last price and applies the BP-2 limit/stop rules. Use it from `validateOrder`, `reserveBuyingPower` and `adjustBuyingPowerReservation`. (BP-1, BP-2)
2. Add `reservedRateByOrderId` to `PortfolioState`; make `adjustBuyingPowerReservation` scale by remaining quantity instead of re-pricing. (BP-3)
3. Add `shortMarginRequirement` to `SimBrokerConfig` and reserve on short-increasing sells. (BP-4)
4. Recompute `reservedCash` from the reservation map instead of incremental arithmetic; release everything at finalisation. (BP-5)

No changes to `onBar`, no read-purity refactor, no `isSynthetic`, no tests — matching your scope.
