# Redis Key Audit (Backend + Market Stream Service)

Date: 2026-04-05

## Scope
- `coreza-backend/src/**`
- `coreza-backend/market-stream-service/src/**`

## Method
- Searched for Redis key-like string literals and direct Redis calls.
- Cross-checked against centralized builders in `src/infra/redisKeys.ts` and `src/config/redisChannels.ts`.

## Findings

### ✅ Fully migrated to hierarchical `userId/workflowId/sessionId/runId`
- Run storage keys (`userId:{userId}:runId:{runId}`)
- Strategy stream keys (`userId:{userId}:workflowId:{workflowId}:strategy:stream`)
- Portfolio fill/snapshot keys
- Loop meta/results/aggregated keys
- Node state keys

### ✅ Fixed during this audit
1. **WorkflowRunner session cleanup pattern** was using legacy `user:{userId}:workflow:{workflowId}:runId:{runnerInstanceId}:*`.
   - Updated to `RedisKeys.sessionPattern(userId, workflowId, runnerInstanceId)`.

### ⚠️ Remaining non-hierarchical keys (intentional or separate namespace)

1. **Market-data namespace (`md:*`)**
   - Used across streaming registration/subscription/filter keys.
   - This is a separate subsystem namespace and appears intentional.

2. **WebSocket namespace (`ws:user:*`)**
   - Pub/sub routing channel for per-user websocket fanout.
   - Appears intentional and consistent with `REDIS_CHANNELS`.

3. **Order idempotency cache**
   - `order:{idempotencyKey}`, `order-reverse:{orderId}`
   - Not yet in `RedisKeys`; currently isolated and global by idempotency key.
   - Recommendation: optionally move to `RedisKeys` as global helpers for consistency.

4. **Credential cache**
   - `cred:{key}`
   - Intentionally global and already called out in migration plan.

5. **Backtest progress**
   - `backtest:progress:{backtestId}`
   - Appears intentional and isolated to backtest service lifecycle.

## Optimization recommendations

1. Continue replacing remaining direct `redis.keys(...)` in streaming cleanup paths with SCAN-based iteration.
2. Consider extending `RedisKeys` with optional helper groups for:
   - WebSocket keys/channels
   - Idempotency cache keys
   - Backtest progress keys
3. Keep `md:*` namespace in `REDIS_CHANNELS` as the source of truth to avoid drift.
