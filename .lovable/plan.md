

## Plan: Centralize Stream Name Building in market-stream-service Only

### Problem
Stream names are being built in two places:
- **SubscriptionService** (coreza-backend): Uses simplified logic `${s.toLowerCase()}@${type}` that doesn't handle kline intervals or depth levels correctly
- **Gateway Helpers** (market-stream-service): Has full broker-specific logic that correctly handles all edge cases

This leads to potential mismatches between what's stored in Redis and what the gateway actually subscribes to.

### Solution
Remove stream name building from SubscriptionService and let MarketControlHandler handle all stream name construction and Redis storage using the existing `buildStreamNames` utility.

---

## Phase 1: Update SubscriptionService to Send Raw Data Only

**File:** `coreza-backend/src/services/SubscriptionService.ts`

### Changes:
1. Remove the `buildStreamNames` import (line 20)
2. Remove the `processStreamTypes` method (lines 103-126)
3. Remove stream name building and Redis storage logic (lines 239-261)
4. Add `interval` and `depthLevels` to control message

**Before (lines 195-267):**
```typescript
let eventTypes: string[] = [];
if (streamTypes && streamTypes.length > 0) {
  eventTypes = this.processStreamTypes(streamTypes, source, interval ?? depth_levels);
}

const controlMessage = {
  action: operation,
  userId,
  workflowId,
  symbols: symbolArray,
  source,
  credentialId,
  eventTypes,  // Processed with intervals baked in
  scope,
};
// ... later ...
const streamNames = symbolArray.flatMap((s) =>
  eventTypes.map((type) => `${s.toLowerCase()}@${type}`),
);
await redis[redisOp](streamsKey, ...streamNames);
```

**After:**
```typescript
// No processStreamTypes call needed

const controlMessage = {
  action: operation,
  userId,
  workflowId,
  symbols: symbolArray,
  source,
  credentialId,
  eventTypes: streamTypes || [],  // RAW event types (kline, trade, etc.)
  scope,
  // Pass raw parameters for stream name building in market-stream-service
  interval,
  depthLevels: depth_levels,
};

// Publish control message - NO Redis stream storage here
await redis.publish(channel, JSON.stringify(controlMessage));
```

---

## Phase 2: Update ControlMessage Interface

**File:** `coreza-backend/market-stream-service/src/services/MarketControlHandler.ts`

Add `interval` and `depthLevels` fields:

```typescript
interface ControlMessage {
  action: "subscribe" | "unsubscribe";
  userId: string;
  workflowId?: string;
  nodeId?: string;
  symbols: string[];
  source: MarketSource;
  credentialId?: string;
  eventTypes?: string[];
  feed?: string;
  environment?: string;
  assetType?: string;
  scope: string;
  targetWorkflowId?: string;
  // NEW: Raw interval/depth for stream name building
  interval?: string;
  depthLevels?: string;
}
```

---

## Phase 3: Update handleSubscribe to Build and Store Stream Names

**File:** `coreza-backend/market-stream-service/src/services/MarketControlHandler.ts`

After the gateway subscription succeeds, build and store stream names in Redis:

```typescript
private async handleSubscribe(msg: ControlMessage): Promise<void> {
  const {
    source,
    userId,
    workflowId,
    symbols,
    eventTypes,
    scope,
    targetWorkflowId,
    interval,      // NEW
    depthLevels,   // NEW
    // ...other fields
  } = msg;

  // ... existing gateway connection and subscription logic ...

  if (subscriptionNeeded.length > 0) {
    // ... existing gateway.subscribeSymbols call ...

    // ===== NEW: Build and store stream names in Redis =====
    // Use the centralized buildStreamNames utility
    const processedEventTypes = this.processEventTypesForStreamNames(
      eventTypes || [],
      source,
      interval,
      depthLevels
    );
    
    const streamNames = buildStreamNames(source, subscriptionNeeded, processedEventTypes);

    // Determine Redis key based on scope
    const streamsKey = scope === "workflow" && targetWorkflowId
      ? REDIS_CHANNELS.workflowSubscriptionStreams(userId, targetWorkflowId, source)
      : REDIS_CHANNELS.globalSubscriptionStreams(userId, source);

    // Store stream names in Redis
    if (streamNames.length > 0) {
      await this.redisPub.sadd(streamsKey, ...streamNames);
      console.log(
        `💾 [MarketControl] Stored ${streamNames.length} stream names in ${streamsKey}:`,
        streamNames.slice(0, 5).join(", ") + (streamNames.length > 5 ? "..." : "")
      );
    }
    // ===== END NEW =====

    // ... rest of existing logic ...
  }
}

/**
 * Process raw event types into format expected by buildStreamNames
 * Handles kline intervals and depth levels for Binance
 */
private processEventTypesForStreamNames(
  eventTypes: string[],
  source: string,
  interval?: string,
  depthLevels?: string
): string[] {
  if (!source.startsWith("binance")) {
    return eventTypes;
  }

  return eventTypes.map((type) => {
    // Kline with interval: kline -> kline_1m
    if (type === "kline" && interval) {
      return `kline_${interval}`;
    }
    // Depth with levels: depth_levels -> depth20
    if ((type === "depth" || type === "depth_levels") && depthLevels) {
      return `depth${depthLevels}`;
    }
    return type;
  });
}
```

---

## Phase 4: Update handleUnsubscribe to Remove Stream Names

**File:** `coreza-backend/market-stream-service/src/services/MarketControlHandler.ts`

Remove stream names from Redis when unsubscribing:

```typescript
private async handleUnsubscribe(msg: ControlMessage): Promise<void> {
  const {
    userId,
    source,
    workflowId,
    symbols,
    eventTypes,
    scope,
    targetWorkflowId,
    interval,      // NEW
    depthLevels,   // NEW
  } = msg;

  // ... existing unsubscribe logic ...

  if (symbols.length > 0) {
    // ... existing gateway.unsubscribeSymbols call ...

    // ===== NEW: Remove stream names from Redis =====
    const processedEventTypes = this.processEventTypesForStreamNames(
      eventTypes || [],
      source,
      interval,
      depthLevels
    );
    
    const streamNames = buildStreamNames(source, symbols, processedEventTypes);

    const streamsKey = scope === "workflow" && targetWorkflowId
      ? REDIS_CHANNELS.workflowSubscriptionStreams(userId, targetWorkflowId, source)
      : REDIS_CHANNELS.globalSubscriptionStreams(userId, source);

    if (streamNames.length > 0) {
      await this.redisPub.srem(streamsKey, ...streamNames);
      console.log(
        `🗑️ [MarketControl] Removed ${streamNames.length} stream names from ${streamsKey}`
      );
    }
    // ===== END NEW =====
  }

  // ... rest of existing logic ...
}
```

---

## Phase 5: Clean Up Unused Code

**File:** `coreza-backend/src/utils/streamName.ts`

This file can be removed since stream name building is now centralized in market-stream-service. The `StatusService` can use `parseStreamName` from the market-stream-service version if needed for displaying stream names on the dashboard.

---

## Summary of Changes

| File | Changes |
|------|---------|
| `coreza-backend/src/services/SubscriptionService.ts` | Remove stream name building, send raw interval/depthLevels in control message |
| `coreza-backend/market-stream-service/src/services/MarketControlHandler.ts` | Add interval/depthLevels to interface, build and store stream names in handleSubscribe, remove in handleUnsubscribe |
| `coreza-backend/src/utils/streamName.ts` | Can be removed (optional) |

---

## Data Flow After Implementation

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  SubscriptionService (coreza-backend)                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Publishes control message with RAW data:                            │   │
│  │ - symbols: ["BTCUSDT", "ETHUSDT"]                                   │   │
│  │ - eventTypes: ["kline", "trade"]  ← Raw, not processed              │   │
│  │ - interval: "1m"                                                    │   │
│  │ - depthLevels: "20"                                                 │   │
│  │                                                                     │   │
│  │ NO stream name building here anymore                                │   │
│  │ NO Redis storage here anymore                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼ Redis Pub/Sub                                │
│                                                                             │
│  MarketControlHandler (market-stream-service)                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 1. Receives control message                                         │   │
│  │ 2. Processes event types: kline + 1m → kline_1m                     │   │
│  │ 3. Uses buildStreamNames() → ["btcusdt@kline_1m", "btcusdt@trade"]  │   │
│  │ 4. Stores stream names in Redis:                                    │   │
│  │    md:user:{userId}:...:streams → SET                               │   │
│  │ 5. Sends to gateway for subscription                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Benefits

1. **Single Source of Truth** - Stream names built only in market-stream-service
2. **Consistency Guaranteed** - Same logic for subscription and storage
3. **No Duplication** - Gateway helpers and Redis storage use same builder
4. **Proper Handling** - kline intervals and depth levels handled correctly
5. **Simpler SubscriptionService** - Just publishes raw data, doesn't need to know broker formats

