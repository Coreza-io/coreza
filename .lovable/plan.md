

# Fix Position & Cancel Order — Updated Plan

## Problems Found

### 1. `cancelOrder` references non-existent `this.tickets` map
The `tickets` map was removed during manual refactoring but `cancelOrder()` (lines 1030-1062) still calls `this.tickets.get()` and `this.tickets.delete()`. This will crash at runtime. The method already handles the `this.orders` map correctly (lines 1022-1028), so the legacy ticket block is dead code.

### 2. `getPortfolioState` accesses `marketValue` on `PositionState`
Line 918: `positions.reduce((s, p) => s + p.marketValue, 0)` — but `PositionState` has no `marketValue` field. It has `quantity` and `currentPrice`. This returns `NaN`.

### 3. `getPosition` uses legacy `this.holdings` instead of `this.positions`
Line 932 reads from `this.holdings` which is a legacy `SpotHolding` mirror. It should read from the primary `this.positions` map and compute `Position` fields from `PositionState`.

---

## Changes

### File: `coreza-backend/src/simulation/PortfolioManager.ts`

**A. Rewrite `cancelOrder` — remove all `this.tickets` references**

Replace lines 1021-1063 with a clean implementation that only uses `this.orders`:
- Look up order by `orderId` in `this.orders`
- If not found, try `this.clientOrderIdIndex` to resolve broker order ID
- If found and status is open, set `status = "canceled"`, update `updatedAt`
- Return `{ removed: boolean, order?: OrderState }`
- No ticket, no OrderEvent append — those are legacy constructs

**B. Fix `getPortfolioState` — compute position market value**

Replace line 918:
```
const positionsValue = positions.reduce((s, p) => s + p.marketValue, 0);
```
with:
```
const positionsValue = positions.reduce((s, p) => s + p.quantity * p.currentPrice, 0);
```

Also convert `PositionState[]` to `Position[]` for the return type by mapping each position with computed `side`, `marketValue`, `unrealizedPnl`.

**C. Fix `getPosition` — use `this.positions` map**

Replace lines 931-944 to read from `this.positions.get(symbol)` instead of `this.holdings.get(symbol)`. Compute the `Position` interface fields:
- `side`: `quantity >= 0 ? "long" : "short"`
- `marketValue`: `quantity * currentPrice`
- `unrealizedPnl`: `(currentPrice - avgEntryPrice) * quantity`

### File: `coreza-backend/src/nodes/executors/PortfolioExecutor.ts`

**D. Update `cancel_order` handler return shape**

Lines 323-330: Update to match new return type (`order?: OrderState` instead of `OrderTicket`). The handler already works correctly with the current shape — just ensure `cancelResult.order` maps to `OrderState`.

---

## What stays unchanged

- `brokerSyncOrderEvent` delta logic — no changes (user explicitly excluded this)
- `applyPositionDelta` flag — no changes (user explicitly excluded this)
- All other executor methods
- `getPendingOrders`, `getPositions`, `initializePortfolio`, `updateMarketPrices`
- Backtest mode — zero changes

