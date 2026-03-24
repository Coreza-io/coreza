

# Portfolio Module Refactor — End-to-End Review

## Verdict: Implementation is solid. 7 issues found (3 bugs, 4 improvements).

---

## BUGS

### 1. `applyExecution` applies position delta unconditionally — breaks Alpaca flow

**File**: `PortfolioManager.ts` line 501

`applyExecutionDerivedPositionDelta()` is always called in `applyExecution()`. But the whole point of the refactor is that for Alpaca, position qty comes from `reconcilePosition(0.9982)` — not from execution. The current code will set position to `1.0` from execution, then `reconcilePosition` corrects it to `0.9982`, but the cost basis/avgEntry is already computed from the wrong quantity.

**Fix**: Add a flag or make position delta opt-in. For Alpaca, `reconcilePosition` is the source of truth. For Binance (no `reconcilePosition` call for spot fills), execution-derived delta is needed.

Suggested approach: Add `applyPositionDelta?: boolean` param to `applyExecution()`, default `true`. Alpaca workflow passes `false` since it uses `reconcilePosition` separately.

### 2. `findOrderByClientId` is O(n) linear scan

**File**: `PortfolioManager.ts` lines 639-644

Every execution that arrives with a `clientOrderId` but no matching `brokerOrderId` triggers a full map scan. With many orders, this is slow.

**Fix**: Add a `clientOrderIdIndex: Map<string, string>` (clientOrderId → brokerOrderId) maintained in `registerOrderIntent` and `applyOrderUpdate`.

### 3. `cancelOrder` deletes from `orders` map — loses history

**File**: `PortfolioManager.ts` line 949

`this.orders.delete(orderId)` removes the order entirely. But canceled orders should stay in the map with `status: "canceled"` so `getOrder()` can still return them for audit/debugging. Only `getV2PendingOrders()` should filter them out (which it already does via `OPEN_ORDER_STATUSES`).

**Fix**: Remove the `this.orders.delete(orderId)` line. The status is already set to `"canceled"`.

---

## IMPROVEMENTS

### 4. Excessive `new Date().toISOString()` calls

Multiple calls to `new Date().toISOString()` within the same method (e.g., `adjustQuoteBalance`, `adjustFeeBalance` each create their own). Pass `now` as a parameter from the parent method.

### 5. `getPortfolioState` still reads from legacy `cashBook` and `holdings`

**File**: `PortfolioManager.ts` lines 1212-1233

The main read path (`getPortfolioState`, `getPositions`, `getCash`, `getTotalEquity`) all read from legacy maps. This works because v2 methods sync to legacy maps, but it means every write has dual bookkeeping overhead. Not a bug, but a migration tax.

**Recommendation**: No change now — this is correct for the migration phase. Note for Phase 5: switch read paths to v2 maps and remove legacy sync.

### 6. `executionKeysSeen` grows unbounded

**File**: `PortfolioManager.ts` line 154

Unlike `fillLedger` (capped at 10,000), `executionKeysSeen` has no cap. For long-running workflows with thousands of fills, this set grows indefinitely.

**Fix**: Either cap it (e.g., use an LRU set with 50,000 max entries) or periodically trim entries older than N hours.

### 7. Trade records from `applyExecutionDerivedPositionDelta` have `commission: 0`

**File**: `PortfolioManager.ts` line 769

When a position close/flip generates a `Trade` record, commission is hardcoded to `0`. The fee was already deducted from the balance, but the trade record doesn't reflect it — making trade-level analytics (net PnL per trade) inaccurate.

**Fix**: Pass `feeAmount` into `applyExecutionDerivedPositionDelta` and proportionally assign it to the closing trade.

---

## What's Well Done

- Clean separation of concerns across 5 methods
- Execution deduplication via composite key fallback is robust
- Legacy wrappers correctly cross-populate v2 state (dual-write)
- `syncPositionToHoldings` keeps legacy consumers working during migration
- Parameter normalizer helpers in executor are clean and reusable
- Ownership check with LRU cache + periodic sweep is efficient
- Portfolio JSON `displayOptions` are well-structured per operation

---

## Recommended Fix Priority

| # | Issue | Severity | Effort |
|---|---|---|---|
| 1 | Position delta in applyExecution breaks Alpaca | **High** | Small — add boolean flag |
| 3 | cancelOrder deletes order history | **Medium** | 1-line delete |
| 2 | findOrderByClientId O(n) scan | **Medium** | Small — add index map |
| 6 | executionKeysSeen unbounded growth | **Low** | Small — add cap |
| 7 | Trade commission always 0 | **Low** | Small — pass fee through |
| 4 | Redundant Date calls | **Low** | Trivial |

Shall I proceed with fixing issues 1-3 (the bugs) first?

