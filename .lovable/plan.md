# Buying-Power Correctness Fix (SimBroker)

Scope: `coreza-backend/src/backtest/simBroker/index.ts` + `interfaces.ts` only. No `onBar` rename, no read-purity refactor, no `isSynthetic`, no tests.

## Current behaviour (verified)

`placeOrder` → `validateOrder` (checks `cash - reservedCash`, :316) → `reserveBuyingPower` (:820). Release on cancel/reject/expire/replace (:232), on full fill (:457, :590), on stale/missing tickets (:367, :372, :381, :521). Partial fills call `adjustBuyingPowerReservation` (:459, :592). `BacktestExecutor.ts:1238` reports `buying_power: cash - reservedCash`.

The lifecycle is complete — every terminal path releases exactly once. The defects are in **how much** gets reserved.

## Defects and logic changes

### BP-1 (high) — reservation priced off the wrong symbol
`validateOrder` (:304), `reserveBuyingPower` (:822) and `adjustBuyingPowerReservation` (:838) all read `state.currentBar?.close`. `currentBar` is one global slot overwritten by whichever symbol was processed last (:350, :358, :541), so in a multi-symbol backtest an AAPL order is reserved at the last MSFT close.

**Change:** new private helper

```
estimateOrderPrice(order): number
  1. worst-case order price (BP-2 rules below)
  2. else symbolState(order.symbol).previousBar?.close
  3. else symbolState(order.symbol).lastFillPrice
  4. else state.currentBar?.close
  5. else 0  -> reject the order instead of reserving at the magic 100
```
Delete the `?? 100` fallback everywhere. If no price is resolvable the order is invalid ("No market price available for <symbol>"), which is safer than silently reserving $100/share.

### BP-2 (high) — worst-case price ignored for limit/stop orders
A buy is always reserved at last close. Lean reserves at the price the order can actually execute at.

**Change**, inside `estimateOrderPrice`:
- `limit`, `stop_limit` buy → `limitPrice`
- `stop_market` buy → `stopPrice`
- `market`, `market_on_open`, `market_on_close` → symbol's last close
- for a **buy**, take `Math.max(orderPrice, lastClose)` so a stop-buy above market is never under-reserved; for a **short sell** take `Math.min(orderPrice, lastClose)` (worst case is the lower proceeds side).

Today a resting limit buy far below market over-reserves, and a stop-market buy above market under-reserves and can overdraw cash on fill.

### BP-3 (medium) — re-pricing on partial fill lets the reservation grow
`adjustBuyingPowerReservation` recomputes the remaining leg at the *current* price. On a rising bar the reservation for the unfilled remainder grows even though cash already left the account for the filled part, so `reservedCash` can exceed `cash` and block unrelated orders.

**Change:** add `reservedRateByOrderId: Record<string, number>` to `PortfolioState`. At placement store `rate = reservation / order.quantity`. On partial fill set `reservation = rate * remainingQuantity` — no re-pricing, monotonically shrinking. Drop the fee re-computation from the adjust path (the fee share is already inside the rate).

### BP-4 (medium) — shorts reserve nothing
`reserveBuyingPower` returns early for any sell (:821). With `allowShort: true`, `validateOrder` skips the held-quantity check (:327) and there is no margin requirement, so a strategy can open unbounded short exposure.

**Change:**
- add `shortMarginRequirement: number` to `SimBrokerConfig`, default `1.0` (100% cash-covered; `DEFAULT_SIM_BROKER_CONFIG` unchanged in behaviour for long-only runs).
- split the sell quantity into a **closing leg** (up to `max(0, currentPosition.quantity)`) and an **opening-short leg** (the remainder).
- reserve only for the opening-short leg: `price * shortQty * shortMarginRequirement + feeShare`. The closing leg reserves nothing — it releases capital.
- `validateOrder` must apply the same split so a sell that opens a short is rejected when `cash - reservedCash` cannot cover the margin.

### BP-5 (medium) — reserving against cash ignores unsettled position value
`validateOrder` compares against `cash - reservedCash` only. That is correct for a cash account and matches the current model, so no change to the definition — but the same expression is duplicated in three places.

**Change:** single accessor `get availableBuyingPower(): number { return this.state.cash - this.state.reservedCash; }`, used by `validateOrder`, the error message, and exposed via a public `getAvailableBuyingPower()` so `BacktestExecutor` reports the identical number instead of recomputing it.

### BP-6 (low) — float drift and orphaned reservations
`reservedCash` is maintained with `+=`/`-=` and clamped by `Math.max(0, ...)` at :855, which hides drift instead of preventing it.

**Change:** private `recomputeReservedCash()` that sums `reservationsByOrderId` and assigns; call it at the end of reserve/adjust/release. Also add `releaseAllReservations()` invoked at backtest finalisation so the final `buying_power` isn't understated by orders that never resolved.

### BP-7 (low) — reserve/release symmetry
`releaseBuyingPower` is already called for sells and no-ops on `undefined` (:854). Once BP-4 lands it does real work; keep the single release path and let the reserve side own the amount. Also delete the entry from `reservedRateByOrderId` there.

## Edit list

`simBroker/interfaces.ts`
- `PortfolioState`: add `reservedRateByOrderId: Record<string, number>`
- `SimBrokerConfig` + `DEFAULT_SIM_BROKER_CONFIG`: add `shortMarginRequirement: 1.0`

`simBroker/index.ts`
- init `reservedRateByOrderId: {}` in the constructor (:118-130)
- new `private estimateOrderPrice(order: Order | OrderRequest): number` (BP-1, BP-2)
- new `private computeReservation(order): number` implementing the buy / closing-sell / opening-short split (BP-4)
- new `get availableBuyingPower()` + public `getAvailableBuyingPower()` (BP-5)
- new `private recomputeReservedCash()` and `releaseAllReservations()` (BP-6)
- rewrite `validateOrder` capital block (:302-337) to use `estimateOrderPrice` + `computeReservation` + `availableBuyingPower`, and to reject when no price is resolvable
- rewrite `reserveBuyingPower` (:820-827) to store the rate and use `computeReservation`
- rewrite `adjustBuyingPowerReservation` (:829-850) to scale by rate × remaining quantity
- `releaseBuyingPower` (:852-857): also clear the rate, then `recomputeReservedCash()`

`backtest/BacktestExecutor.ts`
- `:1238` use `simBroker.getAvailableBuyingPower()`
- call `releaseAllReservations()` in the finalisation path

## Note before starting

There is an unrelated build error to clear first: `src/contexts/ExecutionStoreContext.tsx(126,19)` — `isListening` is not a property of `NodeExecutionData`. It needs adding to that type (from the earlier stop-button work).
