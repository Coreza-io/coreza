

# Critical Bugs: Trading Subscription End-to-End Broken

## The Flow (What Should Happen)

1. User selects `stream_types: ["bar", "order_update"]` in AlpacaSubscribe
2. Backend subscribes to `alpaca_market` (for bars) and `alpaca_trading` (for order fills)
3. Redis stores: `alpaca_market:streams → ["aapl@bar"]`, `alpaca_trading:streams → ["trade_updates"]`
4. User clicks Test on AlpacaStreamData → registers workflow with `source: alpaca_market`
5. Workflow should receive both bar events AND order_update events

## Bug 1: Registration Never Discovers Trading Streams

**Location**: `MarketControlHandler.ts` → `handleRegister()` (lines 157-209)

When AlpacaStreamData registers, it passes `source: "alpaca_market"`. The handler looks up streams from:
```
md:user:{userId}:subscription:scope:workflow:{workflowId}:alpaca_market:streams
→ finds ["aapl@bar"] ✅
```

It **never** checks:
```
md:user:{userId}:subscription:scope:workflow:{workflowId}:alpaca_trading:streams
→ ["trade_updates"] is INVISIBLE ❌
```

The workflow is only registered with `aapl@bar`. It never knows about `trade_updates`.

## Bug 2: Redis Pub/Sub Channel Mismatch

**Location**: `MarketDataGateway.ts` (lines 199-202)

Even if Bug 1 were fixed, there's a deeper issue. The gateway publishes ALL events (including order_updates) using this logic:

```typescript
const stream = `${event.symbol.toLowerCase()}@${event.type}`;
const channel = REDIS_CHANNELS.marketData(stream);
// → publishes to: md:symbol:aapl@order_update
```

But `buildStreamName("alpaca_trading", "*", ...)` returns `"trade_updates"`. The subscriber subscribes to `md:symbol:trade_updates`. The gateway publishes to `md:symbol:aapl@order_update`. **These channels never match** — the message is published to a channel nobody is listening on.

The subscriber has fallback logic (lines 300-306) checking `symbolWorkflows.get("trade_updates")`, but this code only runs AFTER a message is received — which never happens because the Redis channel doesn't match.

## Fixes Required

### Fix 1: Gateway publish — align trading event channels with stream names
**File**: `MarketDataGateway.ts` (lines 199-202)

For trading sources (`alpaca_trading`, `binance_trading`), use the fixed stream name (`trade_updates` / `user_data_stream`) as the Redis channel instead of `{symbol}@{type}`:

```typescript
// Determine Redis publish channel
let stream: string;
if (this.source === "alpaca_trading") {
  stream = "trade_updates";
} else if (this.source === "binance_trading") {
  stream = "user_data_stream";
} else {
  stream = event.timeframe
    ? `${event.symbol.toLowerCase()}@${event.type}_${event.timeframe}`
    : `${event.symbol.toLowerCase()}@${event.type}`;
}
const channel = REDIS_CHANNELS.marketData(stream);
```

This ensures the gateway publishes to `md:symbol:trade_updates`, which the subscriber will be listening on.

### Fix 2: Registration — include companion trading streams
**File**: `MarketControlHandler.ts` → `handleRegister()`, `getWorkflowScopedSymbols()`, `getUserSubscribedSymbols()`

When registering for `alpaca_market` or `alpaca_crypto`, also fetch streams from `alpaca_trading`. When registering for `binance_market`, also fetch from `binance_trading`.

```typescript
// In getWorkflowScopedSymbols and getUserSubscribedSymbols:
// After fetching streams for the primary source, also check companion trading source
const companionSource = this.getCompanionTradingSource(source);
if (companionSource) {
  const tradingKey = `md:user:${userId}:subscription:scope:...:${companionSource}:streams`;
  const tradingStreams = await this.redisPub.smembers(tradingKey);
  tradingStreams.forEach(s => allStreams.add(s));
}
```

Add helper:
```typescript
private getCompanionTradingSource(source: string): string | null {
  if (source === "alpaca_market" || source === "alpaca_crypto") return "alpaca_trading";
  if (source === "binance_market") return "binance_trading";
  return null;
}
```

## Files to Change

| File | Change |
|---|---|
| `market-stream-service/src/services/MarketDataGateway.ts` | Use fixed stream name for trading sources when publishing to Redis |
| `market-stream-service/src/services/MarketControlHandler.ts` | Add companion trading source lookup in `getWorkflowScopedSymbols` and `getUserSubscribedSymbols` |

Two files, two targeted fixes. Everything else (subscribe endpoint, node configs, normalization, stream names) is correct.

