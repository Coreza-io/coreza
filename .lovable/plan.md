

# Portfolio Module Refactor — Detailed Production Plan

## Assessment

The uploaded plan is **architecturally sound** and directly solves the root problems we've been hitting:

1. **Alpaca fractional qty bug** — `filled_qty=1` vs `position_qty=0.9982` can't be resolved when one method (`applyFill`) controls both order state AND position quantity
2. **Binance fee-in-different-asset** — BNB fees deducted from a third asset can't be handled by the current quote-suffix-only cash model
3. **Mixed concerns** — `applyFill()` currently conflates order lifecycle, execution accounting, position mutation, and cash adjustment into one code path

**Recommendation: Yes, proceed with this plan using Option A (minimal-change path with Option B structure).**

---

## What Changes and What Doesn't

**Unchanged:**
- Backtest mode (SimBroker) — zero changes
- `Order`, `OrderEvent`, `OrderTicket` types in `types/order.ts` — kept as-is
- Ownership verification via Redis reverse index — kept
- Frontend node rendering logic — unchanged (just swap the JSON)

**Changed:**
- `PortfolioManager.ts` — new internal state model + new public methods
- `PortfolioExecutor.ts` — new broker-mode operation switch cases
- `Portfolio.json` — new node definition (already provided)
- `portfolio.ts` route — update Zod schema for new fields

---

## Phase 1: PortfolioManager.ts — New State Model + Methods

### 1a. Add new interfaces (top of file)

```typescript
interface OrderState {
  brokerOrderId: string;
  clientOrderId?: string;
  symbol: string;
  side: "buy" | "sell";
  orderType?: string;
  timeInForce?: string;
  status: string;
  origQty: number;
  cumFilledQty: number;
  remainingQty?: number;
  avgFillPrice?: number;
  totalFees: number;
  createdAt: string;
  updatedAt: string;
}

interface ExecutionRecord {
  executionId: string;
  brokerOrderId?: string;
  clientOrderId?: string;
  symbol: string;
  side: "buy" | "sell";
  execQty: number;
  execPrice: number;
  quoteNotional?: number;
  feeAmount: number;
  feeAsset?: string;
  cumFilledQty?: number;
  ts: string;
}

interface PositionState {
  symbol: string;
  quantity: number;
  currentPrice: number;
  avgEntryPrice: number;
  realizedPnl: number;
  openCostBasis: number;
  lastBrokerQuantity?: number;
  updatedAt: string;
}

interface BalanceState {
  asset: string;
  total: number;
  available?: number;
  locked?: number;
  updatedAt: string;
}
```

### 1b. Add new state maps (keep old ones for now)

```typescript
private orders = new Map<string, OrderState>();
private executions = new Map<string, ExecutionRecord>();
private balances = new Map<string, BalanceState>();
private positions = new Map<string, PositionState>();
private executionKeysSeen = new Set<string>();
```

Old maps (`cashBook`, `holdings`, `fillLedger`, `orderCumQtyMap`, `tickets`) stay but are deprecated — only used by legacy `applyFill()` / `registerOrder()`.

### 1c. Add new public methods

**`registerOrderIntent(input)`** — Creates/upserts order state. No cash/position mutation. Replaces `registerOrder()`.

**`applyOrderUpdate(input)`** — Updates order lifecycle (status, cumFilledQty, remainingQty). No cash/position mutation. Derives pending order views.

**`applyExecution(input)`** — Execution ledger + cash/fee accounting. Dedupes by `executionId`. Does NOT mutate position quantity for Alpaca (position comes from `reconcilePosition`).

**`reconcilePosition(input)`** — Sets absolute broker position quantity. This is where `0.9982` gets recorded. Updates `openCostBasis` from execution notional when available.

**`reconcileBalance(input)`** — Upserts asset balance snapshot (total/available/locked). Becomes source of truth for `getCash()`.

### 1d. Add instrument parser

Replace hardcoded `SYMBOL_QUOTE_SUFFIXES` with a generic parser supporting `ETH/USD`, `BTC/USDT`, `BTCUSDT`, `AAPL` formats.

### 1e. Update read methods

- `getPendingOrders()` → derive from `orders` map where status is open/pending/partially_filled
- `getPositions()` → project from `positions` map
- `getCash()` → return from `balances` map (fallback to `cashBook` during transition)
- `getPortfolioState()` → build from new maps
- `getTotalEquity()` → `balances[baseCurrency].total + sum(positions.marketValue)`

### 1f. Update `destroy()` to clear new maps

---

## Phase 2: PortfolioExecutor.ts — New Broker Operations

### 2a. Add parameter normalizer helpers

```typescript
parseRequiredString(value, field): string
parseOptionalNumber(value): number | undefined
normalizeSide(value): "buy" | "sell"
```

### 2b. Add new broker-mode switch cases

| Operation | Calls | Ownership Check |
|---|---|---|
| `register_order_intent` | `pm.registerOrderIntent(...)` | No |
| `apply_order_update` | `pm.applyOrderUpdate(...)` | Yes (broker_order_id or client_order_id) |
| `apply_execution` | `pm.applyExecution(...)` | Yes |
| `reconcile_position` | `pm.reconcilePosition(...)` | No (already scoped to run) |
| `reconcile_balances` | `pm.reconcileBalance(...)` | No |
| `cancel_order` | `pm.cancelOrder(...)` | Maybe |

### 2c. Keep legacy operations as wrappers

- `register_order` → internally calls `registerOrderIntent()` with field aliasing (`fill_id` → `broker_order_id`, `quantity` → `orig_qty`)
- `update_portfolio` → internally calls `applyOrderUpdate()` + `applyExecution()`, logs `legacy_operation_used: true`

---

## Phase 3: Portfolio Route + Node JSON

### 3a. Update Zod schema in `portfolio.ts`

Add new fields to the schema: `broker`, `account_id`, `broker_order_id`, `client_order_id`, `execution_id`, `orig_qty`, `cum_filled_qty`, `exec_qty`, `exec_price`, `position_qty`, `remaining_qty`, `avg_fill_price`, `market_price`, `quote_notional`, `fee_amount`, `fee_asset`, `asset`, `total`, `available`, `locked`, `avg_entry_price`, `realized_pnl`.

Add new operations to the operation enum: `register_order_intent`, `apply_order_update`, `apply_execution`, `reconcile_position`, `reconcile_balances`.

### 3b. Replace `src/nodes/Portfolio.json`

Use the uploaded JSON definition directly.

---

## Phase 4: Broker-Specific Event Mapping (Post-Refactor)

After the core refactor, each broker event maps cleanly:

```text
Alpaca fill event → 3 calls:
  1. apply_order_update (order.status, order.filled_qty)
  2. apply_execution   (price, qty, execution_id)
  3. reconcile_position (position_qty = 0.9982)

Binance executionReport → 2 calls:
  1. apply_order_update (msg.X status, msg.z cumQty)
  2. apply_execution   (msg.l lastQty, msg.L lastPrice, msg.n fee, msg.N feeAsset)

Binance ACCOUNT_UPDATE → 2 calls:
  1. reconcile_position (position qty)
  2. reconcile_balances (asset balances)
```

---

## Files Changed

| File | Change |
|---|---|
| `coreza-backend/src/simulation/PortfolioManager.ts` | Add new interfaces, state maps, 5 new public methods, updated read models, instrument parser. Keep legacy methods as deprecated wrappers. |
| `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` | Add 6 new broker-mode switch cases, parameter normalizers, legacy compatibility layer. |
| `coreza-backend/src/routes/portfolio.ts` | Expand Zod schema with new fields and operations. |
| `src/nodes/Portfolio.json` | Replace with new node definition. |
| `coreza-backend/src/utils/portfolioHelpers.ts` | Minor update to work with `PositionState` in addition to `Position`. |

---

## Rollout Order

1. **PortfolioManager.ts** — add new methods alongside old ones (no breaking changes)
2. **PortfolioExecutor.ts** — add new operations, keep legacy
3. **Route + JSON** — update schema and node definition
4. **Test with Alpaca flow** — verify 3-call pattern resolves the 1 vs 0.9982 bug
5. **Phase 5 (later)** — remove legacy `applyFill()`, `registerOrder()`, `update_portfolio` operation after all graphs migrated

