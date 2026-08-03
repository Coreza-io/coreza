# Live/Broker Portfolio Parity with the Corrected Backtest Engine

## Part 1 — Review of the implemented backtest changes

All items from the buying-power plan are present in `coreza-backend/src/backtest/simBroker/index.ts` and wired into `BacktestExecutor.ts`:

- `estimateOrderPrice` (:839) — per-symbol `previousBar.close`, worst-case limit/stop pricing, `Math.max` for buys / `Math.min` for sells, no `?? 100` fallback.
- `computeReservation` (:874) — closing-leg vs opening-short split, `shortMarginRequirement`, proportional fee share.
- `reserveBuyingPower` / `adjustBuyingPowerReservation` (:813-831) — rate stored at placement, remaining quantity scaled by rate, no re-pricing.
- `releaseBuyingPower` (:833) clears both maps; `recomputeReservedCash` (:913) rebuilds from the map instead of `+=`.
- `availableBuyingPower` getter (:905) used by `validateOrder` (:325) and by `BacktestExecutor:1239`; `releaseAllReservations()` called at finalisation (`BacktestExecutor:930`).
- `applyFill` netPnl (:700) no longer subtracts slippage — double-count gone.

Two small residuals worth folding into the live work below:
- `reserveBuyingPower` divides by `order.quantity` with no guard; a zero-quantity order yields `Infinity`. `validateOrder` rejects `quantity <= 0` first, so it is unreachable today, but the guard belongs in the shared helper.
- `computeReservation`'s closing-leg split uses `Math.max(0, positionQuantity)` only, so it ignores quantity already committed by other resting sell orders on the same symbol (two sells each "closing" the same 100 shares both reserve nothing).

## Part 2 — What is wrong in live/broker mode

`coreza-backend/src/simulation/PortfolioManager.ts` is the live counterpart. Verified gaps:

**LP-1 (high) — no buying-power reservation at all.**
`computeBuyingPower` (:1138) is `Math.max(cash, 0) * margin`. Open orders never consume it, so `getOpenOrders()` can hold unlimited notional while the Risk node still reads full buying power. The backtest now reserves at placement; live does not.

**LP-2 (high) — position-level `realizedPnl` is never accumulated.**
New positions are created with `realizedPnl: 0` (:1053) and `applyPositionUpdate` only ever reads `existing.realizedPnl ?? 0` (:998) — nothing ever writes it. On close, the position is deleted (:944) along with the entry map. So `Position.realizedPnl` and `totalPnl` (:1343, :1405) are always wrong in live. `getPortfolioState` masks this at the portfolio level because `cumulativeRealizedPnl` is re-derived from `this.trades` (:1357), but per-symbol/per-position reads are broken.

**LP-3 (medium) — realized P&L lives only in the trades array.**
`cumulativeRealizedPnl` and `realizedPnlBySymbol` are recomputed by looping every trade on every read (:1357). The backtest now keeps a durable ledger. Live should match, both for correctness across restarts and to stop the O(n) loop on hot reads.

**LP-4 (medium) — `cumulativeFees` sums across currencies.**
`:1362` adds `order.totalFees` for all orders regardless of the fee asset, and `updateFeeBalance` correctly debits the fee against its own asset. The scalar is meaningless in multi-currency accounts.

**LP-5 (medium) — no short-margin concept.**
`updateBalance` (:1143) credits cash on any sell. A sell that opens a short increases reported buying power. The backtest now holds `shortMarginRequirement` against the opening-short leg.

**LP-6 (low) — `slippage: 0` hardcoded on live trades** (:721, :818). Consistent with the corrected netPnl formula (no double-count), but the field is a permanent zero; it should carry the real slip when the broker reports both intended and fill price.

## Part 3 — Changes

### Step 1: Extract the shared reservation math

New `coreza-backend/src/simulation/buyingPower.ts`, pure functions, no class state:

```
estimateOrderPrice({ orderType, side, limitPrice, stopPrice, referencePrice }): number
computeReservation({ side, quantity, price, positionQuantity, committedSellQuantity,
                     fee, shortMarginRequirement }): number
```

Rules identical to the SimBroker versions: worst-case limit/stop price, buy = `max(orderPrice, reference)`, sell = `min(orderPrice, reference)`, closing leg reserves nothing, opening-short leg reserves `price * qty * shortMarginRequirement`, plus the proportional fee share. Add the missing `quantity <= 0 -> 0` guard here (fixes the `Infinity` rate residual) and subtract `committedSellQuantity` from the closing-leg allowance (fixes the double-close residual).

`simBroker/index.ts` then delegates: `estimateOrderPrice` resolves its reference price (`previousBar.close ?? lastFillPrice ?? currentBar.close`) and calls the shared function; `computeReservation` passes the position quantity, the sum of resting sell quantities for the symbol, and the fee-model result. Behaviour for existing backtests is unchanged apart from the two residual fixes.

### Step 2: Reservation ledger in PortfolioManager

Add to the class:

```
private reservationsByOrderId = new Map<string, number>();
private reservedRateByOrderId = new Map<string, number>();
private reservedCashByAsset = new Map<string, number>();
```

Methods mirroring SimBroker:
- `reserveBuyingPower(order: OrderState, quoteAsset: string)` — computes via the shared helper using `order.limitPrice/stopPrice` or the position's `currentPrice` as reference, stores amount + per-unit rate.
- `adjustBuyingPowerReservation(orderId)` — `rate * (origQty - filledQty)`, never re-prices.
- `releaseBuyingPower(orderId)` — deletes both entries.
- `recomputeReservedCash(asset)` — rebuilds the per-asset total from the map.
- `getReservedCash(asset)` / `getAvailableBuyingPower(asset)`.

`computeBuyingPower` (:1138) becomes `max(cash - reservedCash(asset), 0) * margin`. `reconcileBalance` (:1088) keeps trusting a broker-reported `buyingPower` when present — the broker already nets its own holds — but stores the local reserved figure alongside so `getAvailableBuyingPower` returns `min(brokerBP, localBP)`; the conservative side wins.

### Step 3: Hook the lifecycle

In `PortfolioManager`:
- `upsertOrder` / the order-accept path — call `reserveBuyingPower` when an order enters an open status and has no existing reservation.
- The fill path (`applyFillAccounting` / order-update path around :554) — call `adjustBuyingPowerReservation` on partial fill, `releaseBuyingPower` when the order reaches a terminal status.
- Terminal non-fill statuses (canceled/rejected/expired/replaced) already flow through the status update — release there too.
- `reset()` (:299) and `dispose()` (:311) clear all three maps.

In `PortfolioExecutor.ts`:
- `place_order` validation path — reject when `computeReservation(...) > getAvailableBuyingPower(quoteAsset)`, with the same message shape as SimBroker (`Insufficient buying power. Required: $X, Available: $Y`) so backtest and live surface identical errors to the workflow.
- `get_portfolio` / balance output (:721, :818) — report `buying_power: pm.getAvailableBuyingPower(asset)` instead of raw `account.buying_power ?? cash`, and add `reserved_cash` to the balance payload.

### Step 4: Durable realized P&L ledger (LP-2, LP-3, LP-4)

- Add `cumulativeRealizedPnl: number`, `realizedPnlBySymbol: Map<string, number>`, `cumulativeFeesByAsset: Map<string, number>` as real fields.
- When `applyTrade` finalises a trade (:807-827 and the no-fill terminal branch at :710), increment the ledger by `trade.netPnl` and index it by symbol — before the position can be deleted.
- In `applyPositionUpdate`, add the closing leg's realized P&L onto `existing.realizedPnl` so live positions report the same `realizedPnl` / `totalPnl` semantics as backtest positions, and migrate it into the ledger just before `this.positions.delete` (:944).
- `getPortfolioState` (:1355-1365) reads the ledger instead of re-looping `this.trades`, and returns `cumulativeFeesByAsset` alongside a base-currency `cumulativeFees` (only fees in the base asset) rather than a mixed-currency sum.
- `updateFeeBalance` (:1185) increments `cumulativeFeesByAsset` for its asset.

### Step 5: Short margin in live (LP-5)

- Add `shortMarginRequirement` to the PortfolioManager construction options, default `1.0`, sourced from the portfolio-init node values so it stays config-driven and broker-agnostic.
- `updateBalance` continues to credit sale proceeds, but the opening-short leg's margin is held through the reservation ledger (Step 2) rather than by altering cash — that keeps cash reconcilable against the broker while still shrinking available buying power.

### Step 6: Slippage on live trades (LP-6)

When the order-update event carries both a requested price (`limitPrice`, or the mark at submit time) and a fill price, record `slippage = |fillPrice - requestedPrice| * qty` on the pending trade and emit it on the `Trade`. `netPnl` stays `grossPnl - commission` — slippage remains reporting-only, exactly as in the corrected backtest.

## Files touched

- new `coreza-backend/src/simulation/buyingPower.ts`
- `coreza-backend/src/backtest/simBroker/index.ts` — delegate to the shared helper (Step 1)
- `coreza-backend/src/simulation/PortfolioManager.ts` — Steps 2, 3, 4, 5, 6
- `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` — pre-trade check and balance reporting (Step 3)
- `coreza-backend/src/nodes/logic/risk.ts` — read available (net of reserved) buying power

No tests, per your standing preference.
