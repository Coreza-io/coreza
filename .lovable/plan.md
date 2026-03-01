

# Fix: LiveStrategyRunner Redis Connection Type

## Problem

`LiveStrategyRunner` creates its Redis connection using `createDedicatedCacheConnection()`, which applies **cache** Redis options:
- `enableOfflineQueue: false` -- rejects commands if connection isn't ready
- `maxRetriesPerRequest: 3` -- fails after 3 retries
- `autoResendUnfulfilledCommands: false`

These settings are designed for short-lived cache lookups that should fail fast. But the runner uses `XREADGROUP BLOCK 5000` -- a long-lived blocking read that needs a persistent, tolerant connection (like BullMQ queue connections).

When the Redis connection hasn't fully established before `start()` calls `xreadgroup`, it throws: *"Stream isn't writeable and enableOfflineQueue options is false"*.

## Fix

**File**: `coreza-backend/src/config/redis.ts`

Add a new function `createDedicatedQueueConnection` (or rename/repurpose) that uses **queue** options instead of cache options:

```typescript
export function createDedicatedStreamConnection(label: string): Redis {
  return createRedisInstance("queue", `Stream (${label})`);
}
```

This uses queue options which have:
- `maxRetriesPerRequest: null` -- never gives up (required for blocking reads)
- `enableOfflineQueue` defaults to `true` -- buffers commands until connected
- `enableReadyCheck: false` -- doesn't wait for ready check

**File**: `coreza-backend/src/services/LiveStrategyRunner.ts`

Change the import and connection creation:

```typescript
import { createDedicatedStreamConnection } from "../config/redis";

// In constructor:
this.redisStream = createDedicatedStreamConnection(`Strategy-${workflowId}`);
```

## Why This Works

The queue Redis profile is designed for exactly this use case -- long-lived connections with blocking operations (BullMQ workers use the same profile). The cache profile is optimized for short request/response patterns where you want fast failure, which is the opposite of what a stream consumer needs.

## Files Changed

| File | Change |
|---|---|
| `coreza-backend/src/config/redis.ts` | Add `createDedicatedStreamConnection` using queue options |
| `coreza-backend/src/services/LiveStrategyRunner.ts` | Switch from `createDedicatedCacheConnection` to `createDedicatedStreamConnection` |

