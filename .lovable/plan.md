# Plan: Centralize Stream Name Building in market-stream-service Only

## Status: ✅ COMPLETED

### Problem (Solved)
Stream names were being built in two places:
- **SubscriptionService** (coreza-backend): Used simplified logic `${s.toLowerCase()}@${type}` that didn't handle kline intervals or depth levels correctly
- **Gateway Helpers** (market-stream-service): Has full broker-specific logic that correctly handles all edge cases

This led to potential mismatches between what was stored in Redis and what the gateway actually subscribed to.

### Solution Implemented
Removed stream name building from SubscriptionService and let MarketControlHandler handle all stream name construction and Redis storage using the existing `buildStreamNames` utility.

---

## Changes Made

### Phase 1: SubscriptionService Updated ✅
**File:** `coreza-backend/src/services/SubscriptionService.ts`

- Removed `buildStreamNames` import
- Removed `processStreamTypes` method
- Removed stream name building and Redis storage logic
- Now sends RAW `eventTypes`, `interval`, and `depthLevels` in control message
- No longer stores stream names in Redis (delegated to market-stream-service)

### Phase 2: ControlMessage Interface Updated ✅
**File:** `coreza-backend/market-stream-service/src/services/MarketControlHandler.ts`

Added new fields:
```typescript
interface ControlMessage {
  // ... existing fields ...
  interval?: string;
  depthLevels?: string;
}
```

### Phase 3: handleSubscribe Updated ✅
After gateway subscription succeeds, builds and stores stream names:
- Uses `processEventTypesForStreamNames()` to transform raw types (kline → kline_1m)
- Uses `buildStreamNames()` utility for broker-specific format
- Stores in Redis using `sadd`

### Phase 4: handleUnsubscribe Updated ✅
Removes stream names from Redis when unsubscribing:
- Uses same `processEventTypesForStreamNames()` and `buildStreamNames()` logic
- Removes from Redis using `srem`

### Phase 5: New Helper Method Added ✅
```typescript
private processEventTypesForStreamNames(
  eventTypes: string[],
  source: string,
  interval?: string,
  depthLevels?: string
): string[]
```
Handles broker-specific transformations:
- Binance: `kline` + `1m` → `kline_1m`
- Binance: `depth_levels` + `20` → `depth20`

---

## Data Flow After Implementation

```text
SubscriptionService (coreza-backend)
┌─────────────────────────────────────────────────────────────────────┐
│ Publishes control message with RAW data:                            │
│ - symbols: ["BTCUSDT", "ETHUSDT"]                                   │
│ - eventTypes: ["kline", "trade"]  ← Raw, not processed              │
│ - interval: "1m"                                                    │
│ - depthLevels: "20"                                                 │
│                                                                     │
│ NO stream name building here anymore                                │
│ NO Redis storage here anymore                                       │
└─────────────────────────────────────────────────────────────────────┘
                             │
                             ▼ Redis Pub/Sub

MarketControlHandler (market-stream-service)
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Receives control message                                         │
│ 2. Processes event types: kline + 1m → kline_1m                     │
│ 3. Uses buildStreamNames() → ["btcusdt@kline_1m", "btcusdt@trade"]  │
│ 4. Stores stream names in Redis:                                    │
│    md:user:{userId}:...:streams → SET                               │
│ 5. Sends to gateway for subscription                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Benefits Achieved

1. **Single Source of Truth** - Stream names built only in market-stream-service
2. **Consistency Guaranteed** - Same logic for subscription and storage
3. **No Duplication** - Gateway helpers and Redis storage use same builder
4. **Proper Handling** - kline intervals and depth levels handled correctly
5. **Simpler SubscriptionService** - Just publishes raw data, doesn't need to know broker formats
