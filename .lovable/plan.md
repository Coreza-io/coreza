

# The Core Problem: How to Correlate Fill Events to Your Orders

You're right to question this. The current `fill_id` approach has a gap: when a fill event arrives via AlpacaStreamData, **all** fill events for all orders arrive on the same stream — not just yours. If another system or manual trade fills on the same Alpaca account, those fills would also arrive and could be incorrectly applied to your portfolio.

## How Correlation Already Works (You Just Need to Wire It)

The system already has the pieces — they just need connecting:

1. **Trade node places order** → Alpaca returns `orderId` (e.g., `b0b6dd9d-8b9b-48a9-ba46-b9d54906e415`). The idempotency system also sends this as `client_order_id`.

2. **Alpaca WebSocket sends fill event** → Contains `order.orderId` (same value) in the `order_update` payload (see `MarketDataSubscriber.ts` line 471).

3. **The `orderId` from step 1 = `orderId` from step 2** — Alpaca guarantees this. That's how you know it's YOUR order.

## The Real Question: How Does the Stream Trigger Know Which Order to Match?

In a live workflow, the flow is:

```text
AlpacaSubscribe (stream running) ──────────────────────────┐
                                                           │
AlpacaTrade (place order) → orderId: "abc123"              │
                                                           │
... time passes ...                                        │
                                                           │
AlpacaStreamData (triggered by fill) ← orderId: "abc123" ←┘
   │
   └─→ Portfolio (Sync Fills) ← needs to verify "abc123" is ours
```

The problem: Portfolio Sync Fills receives ALL fill events from the account. It needs to know which `orderId`s belong to this workflow.

## Recommended Approach: Use the Existing Redis Order Cache as the Registry

The idempotency system (`orderIdempotency.ts`) already caches every order placed by the Trade node in Redis with `order:{idempotencyKey}` → `{ orderId, status, ... }`. This is your order registry.

### What to build

**Add an order lookup utility** that checks if an incoming `orderId` was placed by this system:

```typescript
// New function in orderIdempotency.ts
async function isOurOrder(orderId: string): Promise<boolean>
```

This scans the Redis order cache for a matching `orderId`. To make this efficient, add a **reverse index**: when `updateOrderCache` stores the orderId, also set `order-reverse:{orderId}` → `idempotencyKey`.

**Add a filter condition in the Portfolio executor** (or as a separate utility the user can reference):
- When `fill_id` is provided, check `isOurOrder(fill_id)` before applying
- If not our order, skip with `{ applied: false, reason: "unknown_order" }`

### Changes

| File | Change |
|---|---|
| `coreza-backend/src/utils/orderIdempotency.ts` | Add reverse index `order-reverse:{orderId}` in `updateOrderCache()`. Add `isOurOrder(orderId)` lookup function. |
| `coreza-backend/src/services/PortfolioManager.ts` | Add `fillId` param to `applyFill()`, check `fillIdSet` for dedup, return `{ applied, reason }` |
| `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` | Read `fill_id`, call `isOurOrder()` to verify, then pass to `applyFill()` with dedup. Return `skipped: true` with reason if not our order or duplicate. |
| `src/nodes/Portfolio.json` | Add optional `fill_id` text field for `update_portfolio` |

### Workflow wiring

```text
Portfolio (Sync Fills):
  fill_id: {{ $(AlpacaStreamData).json.data.order.orderId }}
```

The executor then:
1. Checks Redis reverse index → is this orderId one we placed? If no → skip
2. Checks fillIdSet → already processed this fill? If yes → skip (dedup)
3. Applies fill → updates positions, cash, records trade

This gives you **ownership verification + deduplication** with zero new nodes, using infrastructure that already exists.

