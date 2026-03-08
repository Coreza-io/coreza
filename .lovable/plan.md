

# Plan: Fix Race Condition, Partial Fills, and Performance in Fill Deduplication

## Three Issues to Fix

### Issue 1: Race Condition — Fill arrives before reverse index exists

**Current flow:**
1. `cacheOrderIntent(key, broker)` — writes `order:{key}` with status `pending` (no orderId yet)
2. Broker API call executes
3. `updateOrderCache(key, "success", data, orderId)` — writes reverse index `order-reverse:{orderId}`

If Alpaca sends a fill event via WebSocket **before step 3 completes**, `isOurOrder(orderId)` returns `false` and the fill is incorrectly skipped.

**Fix:** Write the reverse index eagerly in `cacheOrderIntent` using the idempotency key as `client_order_id`. Alpaca echoes back `client_order_id` in order events, so we can use it as a secondary lookup. Additionally, pass `orderId` to `cacheOrderIntent` right after the broker response, before any async gap.

Actually, the simpler fix: the `client_order_id` sent to Alpaca IS the idempotency key (32-char hex). The fill event from Alpaca contains `client_order_id`. So we write the reverse index using `client_order_id` at intent time (before submission), and in the fill event we look up by `client_order_id` first, then by `orderId`.

**Concrete change in `orderIdempotency.ts`:**
- In `cacheOrderIntent()`, also write `order-reverse:{idempotencyKey}` → `idempotencyKey` (self-referencing). Since the idempotency key IS the `client_order_id` sent to Alpaca, any fill event containing that `client_order_id` will match.
- Add a new function `registerOrderId(idempotencyKey, orderId)` that writes the `order-reverse:{orderId}` reverse index. Called from `updateOrderCache` (already done) but also directly from `BrokerExecutor` right after receiving the response, ensuring the reverse index exists before any WebSocket event can arrive.

**Concrete change in `PortfolioExecutor.ts`:**
- Accept both `fill_id` (orderId) and `client_order_id` fields. Try `isOurOrder(fill_id)` first, then `isOurOrder(client_order_id)` as fallback.

### Issue 2: Partial Fills — Same orderId, multiple cumulative updates

Alpaca sends multiple `order_update` events for the same order during partial fills. Each event has `filledQty` as the **cumulative** filled quantity. Current code uses `orderId` as dedup key — so the second partial fill is rejected as "duplicate".

**Fix:** Add an `orderCumQtyMap` to `PortfolioManager` that tracks cumulative filled quantity per orderId. On each fill event, compute `deltaQty = newCumQty - previousCumQty`. Only apply the delta. If delta is 0, skip.

**Concrete changes in `PortfolioManager.ts`:**
- Add `private orderCumQtyMap = new Map<string, number>()` — tracks `orderId → cumulative qty applied`
- Clear it in `destroy()`
- Modify `applyFill()`:
  - Remove the simple `fillIdSet` duplicate check for fillId-based fills
  - Instead: if `fillId` provided, look up `orderCumQtyMap.get(fillId)`. Compute `delta = abs(quantity) - previousCumQty`. If `delta <= 0`, skip as duplicate. Otherwise apply only the delta quantity, then update `orderCumQtyMap.set(fillId, abs(quantity))`
  - Keep `fillIdSet` for non-fillId manual fills only

### Issue 3: Performance — Redis lookup on every fill

Every fill event triggers a Redis `GET` for `isOurOrder()`. In high-frequency scenarios this adds latency.

**Fix:** Add an in-memory LRU cache in `PortfolioExecutor` for ownership results. Since order ownership doesn't change, a cache with 5-minute TTL is safe.

**Concrete changes in `PortfolioExecutor.ts`:**
- Add `private static orderOwnershipCache = new Map<string, { ours: boolean; expiry: number }>()`
- Before calling `isOurOrder()`, check the local cache. If hit and not expired, use cached result.
- After calling `isOurOrder()`, store result with `expiry = Date.now() + 300_000` (5 min)

---

## Files to Change

| File | Changes |
|---|---|
| `coreza-backend/src/utils/orderIdempotency.ts` | Write reverse index in `cacheOrderIntent()` using idempotency key (= client_order_id). No new functions needed — existing `isOurOrder` already handles it. |
| `coreza-backend/src/services/PortfolioManager.ts` | Add `orderCumQtyMap`. Change `applyFill()` from simple dedup to delta-based partial fill tracking. Clear map in `destroy()`. |
| `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` | Add local ownership cache. Accept `client_order_id` as fallback lookup. |
| `src/nodes/Portfolio.json` | Add optional `client_order_id` field for `update_portfolio` (fallback for race condition). |

## Detailed Code Changes

### `orderIdempotency.ts` — Eager reverse index

In `cacheOrderIntent()` (~line 76), after writing the order cache, also write:
```typescript
// Pre-register reverse index using idempotency key (= client_order_id sent to broker)
await redis.setex(`order-reverse:${idempotencyKey}`, ORDER_CACHE_TTL, idempotencyKey);
```

This ensures that even before the broker responds with an `orderId`, any fill event containing the `client_order_id` (which equals the idempotency key) can be verified.

### `PortfolioManager.ts` — Delta-based partial fill tracking

Add new field:
```typescript
private orderCumQtyMap = new Map<string, number>(); // orderId → cumulative qty applied
```

Clear in `destroy()`:
```typescript
this.orderCumQtyMap.clear();
```

Rewrite `applyFill()` dedup logic:
```typescript
applyFill(
  fill: { symbol: string; quantity: number; price: number; commission?: number },
  baseCurrency: string,
  fillId?: string,
): { applied: boolean; reason?: string; deltaQty?: number } {
  const { symbol, quantity, price, commission = 0 } = fill;
  const absQty = Math.abs(quantity);
  const side: "BUY" | "SELL" = quantity > 0 ? "BUY" : "SELL";

  let effectiveQty = absQty;

  if (fillId) {
    // Delta-based partial fill tracking
    const previousCumQty = this.orderCumQtyMap.get(fillId) || 0;
    const delta = absQty - previousCumQty;

    if (delta <= 0) {
      console.log(`[PortfolioManager] No new fill quantity for ${fillId}: cum=${absQty}, prev=${previousCumQty}`);
      return { applied: false, reason: "no_new_fill", deltaQty: 0 };
    }

    effectiveQty = delta;
    this.orderCumQtyMap.set(fillId, absQty);
  }

  const tradeId = fillId ? `${fillId}-${absQty}` : `MANUAL-${++this.tradeIdCounter}`;

  const liveFill: LiveFill = {
    tradeId,
    orderId: fillId,
    symbol,
    side,
    qty: effectiveQty,
    price,
    commission: commission * (effectiveQty / absQty), // Prorate commission to delta
    commissionAsset: this.extractQuoteAsset(symbol) ?? baseCurrency,
    eventTime: Date.now(),
  };

  this.fillIdSet.add(`${symbol}:${tradeId}`);
  this.fillLedger.push(liveFill);
  this.applyFillToHoldings(liveFill, true);
  this.updatePeakEquity(baseCurrency);

  console.log(
    `[PortfolioManager] Applied fill: ${side} ${effectiveQty} ${symbol} @ ${price} (delta from cum ${absQty}, fillId: ${fillId || tradeId})`,
  );
  return { applied: true, deltaQty: effectiveQty };
}
```

### `PortfolioExecutor.ts` — Local ownership cache + client_order_id fallback

Add static cache:
```typescript
private static ownershipCache = new Map<string, { ours: boolean; expiry: number }>();
```

Add helper:
```typescript
private async checkOwnership(id: string): Promise<boolean> {
  const cached = PortfolioExecutor.ownershipCache.get(id);
  if (cached && cached.expiry > Date.now()) return cached.ours;

  const result = await isOurOrder(id);
  PortfolioExecutor.ownershipCache.set(id, { ours: result.ours, expiry: Date.now() + 300_000 });
  return result.ours;
}
```

In `update_portfolio` case, replace the ownership check:
```typescript
const fillId = params.fill_id?.trim() || undefined;
const clientOrderId = params.client_order_id?.trim() || undefined;

if (fillId || clientOrderId) {
  const isOurs = (fillId && await this.checkOwnership(fillId)) ||
                 (clientOrderId && await this.checkOwnership(clientOrderId));
  if (!isOurs) {
    return toNodeResult(createSuccessOutput({
      updated: false, skipped: true, reason: "unknown_order",
      fill_id: fillId, client_order_id: clientOrderId,
      message: "Order was not placed by this system — fill skipped",
      ...this.getPortfolioSummary(pm, baseCurrency),
    }));
  }
}
```

### `Portfolio.json` — Add client_order_id field

Add after the `fill_id` field:
```json
{
  "key": "client_order_id",
  "label": "Client Order ID (Fallback)",
  "type": "text",
  "placeholder": "{{ $(AlpacaStreamData).json.data.order.client_order_id }}",
  "required": false,
  "description": "Fallback dedup key if orderId not yet indexed. Maps to the client_order_id sent with the original order.",
  "displayOptions": {
    "show": {
      "operation": ["update_portfolio"]
    }
  }
}
```

