

# WorkflowRunner Refactor — Updated Plan

## Summary

Refactor `WorkflowRunner` for reliability and maintainability. Keep class name as `WorkflowRunner`. Fix frontend build errors.

## Changes

### File: `coreza-backend/src/services/WorkflowRunner.ts`

**1. Rename fields (no class rename)**
- `runnerId` → `runnerInstanceId`
- `redisStream` → `streamRedisClient`
- `workflowSnapshot` → `serializedSnapshot` (camelCase internals: `nodeCount`, `edgeCount`)

**2. Split `start()` into focused methods**
```text
start()                    — guard + ensureConsumerGroup + reclaimPending + pollLoop
ensureConsumerGroup()      — XGROUP CREATE, catch BUSYGROUP only
reclaimPendingMessages()   — XAUTOCLAIM with 60s idle threshold on startup
pollLoop()                 — while(running) XREADGROUP with try/catch + backoff
processMessage(id, fields) — single message lifecycle with error boundaries
extractPayload(fields)     — field extraction, returns string | undefined
parseEnvelope(raw)         — JSON parse + normalize to StreamEventEnvelope type
recordSuccess(runId, result, messageId) — updateRunStatusInRedis wrapper
recordFailure(runId, error)             — updateRunStatusInRedis wrapper
```

**3. Error boundaries in `processMessage()`**
```text
processMessage(messageId, fields):
  ├─ extractPayload → null? → ack (permanent: bad message)
  ├─ parseEnvelope  → throws? → ack (permanent: invalid JSON)
  ├─ createRunInRedis → throws? → do NOT ack (transient: retry on next claim)
  ├─ engine.resetForNextBar(true)
  ├─ engine.execute → success → recordSuccess → ack
  │                 → failure → recordFailure → ack (execution failed, not retryable)
  └─ ack failure → log warning, continue
```

**4. Add `XAUTOCLAIM` on startup**
After consumer group creation, reclaim messages idle >60s from dead consumers.

**5. Define `StreamEventEnvelope` type**
```typescript
interface StreamEventEnvelope {
  type?: string;
  data: unknown;
  timestamp?: string;
  symbol?: string;
}
```
Normalize once in `parseEnvelope()`. No more `event?.data ?? event` fallback.

**6. Poll loop resilience**
Wrap `xreadgroup` in try/catch. On transient Redis error, log warning and retry after 1s backoff instead of crashing the loop.

### File: `coreza-backend/src/services/workflowRunnerManager.ts`

No changes — class name stays `WorkflowRunner`.

### File: `src/hooks/useExecutionHistory.ts`

**7. Fix build errors — add `data` and `meta` to `ExecutionResultPayload`**
```typescript
export interface ExecutionResultPayload {
  success?: boolean;
  result?: Record<string, ExecutionNodeResult>;
  nodeExecutions?: NodeExecutionLog[];
  executionOrder?: string[];
  error?: string | { code?: string; phase?: string; message?: string };
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}
```

## What We Skip

- Class rename to `LiveStrategyRunner` — keeping `WorkflowRunner`
- `resetForNextBar(true)` rename — engine API, out of scope
- PortfolioManager cleanup ownership — current approach is correct

## Files Changed

| File | Change |
|---|---|
| `coreza-backend/src/services/WorkflowRunner.ts` | Field renames, split start(), error boundaries, XAUTOCLAIM, envelope type |
| `src/hooks/useExecutionHistory.ts` | Add `data`/`meta` to interface (fixes 3 TS2339 errors) |

