

# Plan: Add Pending Order Ledger to PortfolioManager

## The Problem

Currently, `PortfolioManager` (broker mode) has no awareness of order lifecycle. It only reacts to fills. This creates a gap:

1. Strategy places a BUY order via Trade node
2. Order is accepted but not yet filled
3. Strategy runs again — it has no way to know an order is pending
4. Strategy might place a **duplicate** order

SimBroker (backtest mode) solves this with `pendingOrders[]`. PortfolioManager needs the same concept.

## The Solution: In-Memory Pending Order Ledger

Track the order lifecycle entirely from events the system already produces — no broker API polling needed.

```text
Trade node places order → register_order() → pendingOrders ledger
                                                    │
WebSocket fill event → update_portfolio (fill)      │
  ├─ partial fill → update pending qty remaining  ←─┘
  ├─ full fill → remove from pending, apply to holdings
  └─ cancelled/rejected → remove from pending
```

Two new Portfolio operations:
- **`register_order`** — called after Trade node succeeds, records the order as pending
- **`cancel_order`** — removes an order from pending (for cancelled/expired/rejected events)

The existing `update_portfolio` operation gains logic to **auto-decrement** the pending order when a fill is applied.

### Data flow in a workflow

```text
AlpacaStreamData (order_update event)
  │
  ├─ If event.type = "new" / "accepted"
  │     → Portfolio (register_order): symbol, orderId, side, qty, price
  │
  ├─ If event.type = "fill" / "partial_fill"  
  │     → Portfolio (update_portfolio): fill fields + fill_id
  │       (internally: apply fill + decrement/remove pending order)
  │
  └─ If event.type = "canceled" / "rejected" / "expired"
        → Portfolio (cancel_order): fill_id = orderId
          (internally: remove from pending ledger)
```

## Changes

| File | Change |
|---|---|
| `coreza-backend/src/services/PortfolioManager.ts` | Add `PendingOrder` interface. Add `pendingOrders` Map. Add `registerOrder()`, `cancelOrder()`, `getPendingOrders()`, `getPendingOrder()`. Modify `applyFill()` to auto-decrement pending qty on fill. |
| `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` | Add `register_order` and `cancel_order` case handlers. Include `pending_orders` in portfolio summary output. Add `get_pending_orders` operation. |
| `src/nodes/Portfolio.json` | Add `register_order`, `cancel_order`, `get_pending_orders` operations with their fields. |

## Detailed Design

### PendingOrder interface (PortfolioManager.ts)

```typescript
interface PendingOrder {
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  originalQty: number;
  filledQty: number;      // cumulative filled so far
  remainingQty: number;
  limitPrice?: number;
  status: "pending" | "partially_filled";
  registeredAt: number;    // epoch ms
}
```

### PortfolioManager new methods

- **`registerOrder(order)`** — adds to `pendingOrders` Map keyed by `orderId`. Idempotent (if orderId already exists, updates status).
- **`cancelOrder(orderId)`** — removes from `pendingOrders`. Returns `{ removed: boolean }`.
- **`getPendingOrders()`** — returns all pending orders as array.
- **`getPendingOrder(orderId)`** — returns single pending order or null.

### Auto-link in `applyFill()`

When a fill with `fillId` is applied, check `pendingOrders` for a matching orderId:
- Update `filledQty` and `remainingQty`
- If `remainingQty <= 0`, remove from pending (order fully filled)
- If `remainingQty > 0`, set status to `"partially_filled"`

### Portfolio summary enhancement

`getPortfolioSummary()` in the executor will include:
```typescript
pending_orders: pm.getPendingOrders(),
pending_orders_count: pm.getPendingOrders().length,
```

This mirrors what SimBroker already outputs for backtest mode.

### Why this works without polling

The system already receives **all order lifecycle events** via the AlpacaStreamData / BinanceStreamData trigger nodes (when "Include Order Updates" is checked). These events include:
- `new` / `accepted` → register
- `partial_fill` / `fill` → update portfolio (which auto-decrements pending)
- `canceled` / `rejected` / `expired` → cancel

The user simply routes these events through an If node to the appropriate Portfolio operation. No broker API call needed.

