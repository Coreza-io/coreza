

# Plan: Redis Streams Fill Persistence Pipeline (Full End-to-End)

## Overview

Persist live fills and cash snapshots from the trading hot path to Supabase via a Redis Streams pipeline. Zero impact on execution latency. Workflow-scoped Redis keys for multi-workflow isolation.

---

## Architecture

```text
Hot path (brokerSyncOrderEvent ~0.1ms added):
  ├── applyOrderUpdate / applyTrade / applyPositionUpdate / applyFillAccounting  (existing)
  ├── computeFillDelta()                                      ← NEW
  ├── XADD {userId}:{workflowId}:portfolio:fills:stream       ← NEW (~0.1ms)
  └── SET  {userId}:{workflowId}:portfolio:snapshot:latest     ← NEW (~0.05ms)

Background worker (FillSyncWorker, every 10s):
  ├── SCAN for *:portfolio:fills:stream keys
  ├── XREADGROUP GROUP fill-sync worker-1 COUNT 100 BLOCK 2000
  ├── Dedupe by event_id
  ├── Batch UPSERT → live_fills (Supabase)
  ├── XACK only after DB success
  ├── Flush latest snapshots → cash_snapshots (Supabase)
  └── Poison messages → DLQ after 5 retries

Frontend (existing, no changes needed):
  ├── SELECT * FROM live_fills WHERE user_id = ?
  ├── SELECT * FROM cash_snapshots WHERE user_id = ?
  └── Realtime subscription on INSERT
```

---

## Redis Key Design

| Key | Type | Purpose |
|-----|------|---------|
| `{userId}:{workflowId}:portfolio:fills:stream` | Stream | Fill events per workflow |
| `{userId}:{workflowId}:portfolio:snapshot:latest` | String (JSON) | Latest coalesced portfolio snapshot |
| `portfolio:fills:dlq` | Stream | Dead letter queue for poison messages |
| `portfolio:fills:active_streams` | Set | Registry of active stream keys (for SCAN-free discovery) |

**Why workflow-scoped keys?** Each live workflow tracks its own fills independently. The worker discovers active streams via the `portfolio:fills:active_streams` set rather than expensive SCAN operations.

---

## Files to Create/Modify

### 1. NEW: `coreza-backend/src/services/FillEventBus.ts` (~50 lines)

Thin wrapper around `XADD`. Used by the hot path (fire-and-forget, no await).

```ts
import { getRedisCache } from "../config/redis";
import logger from "../utils/logger";

export interface FillStreamEvent {
  event_id: string;           // deterministic idempotency key
  user_id: string;
  workflow_id: string;
  run_id?: string;
  broker: string;
  credential_id?: string;
  symbol: string;
  side: "buy" | "sell";
  order_id?: string;
  execution_id?: string;      // broker execution/fill ID
  fill_qty_delta: number;     // DELTA only, not cumulative
  fill_price: number;
  quote_qty?: number;
  commission?: number;
  commission_asset?: string;
  event_time: string;
  base_currency?: string;
}

export class FillEventBus {
  static async publish(event: FillStreamEvent): Promise<void> {
    const redis = getRedisCache();
    const streamKey = `${event.user_id}:${event.workflow_id}:portfolio:fills:stream`;

    // Register stream key for discovery
    await redis.sadd("portfolio:fills:active_streams", streamKey);

    // XADD with auto-trim
    await redis.xadd(
      streamKey, "MAXLEN", "~", "100000", "*",
      ...Object.entries(event).flatMap(([k, v]) =>
        v !== undefined && v !== null ? [k, String(v)] : []
      )
    );
  }
}
```

### 2. NEW: `coreza-backend/src/services/SnapshotCache.ts` (~40 lines)

Coalesces snapshots — only the latest state per workflow is kept. Flushed by the background worker.

```ts
export interface LatestSnapshotState {
  user_id: string;
  workflow_id: string;
  run_id?: string;
  broker: string;
  credential_id?: string;
  snapshot_at: string;
  base_currency?: string;
  cash?: number;
  equity?: number;
  realized_pnl?: number;
  unrealized_pnl?: number;
  positions_count?: number;
  balances_json?: unknown;
}

export class SnapshotCache {
  static async upsertLatest(snapshot: LatestSnapshotState): Promise<void> {
    const redis = getRedisCache();
    const key = `${snapshot.user_id}:${snapshot.workflow_id}:portfolio:snapshot:latest`;
    await redis.set(key, JSON.stringify(snapshot), "EX", 86400); // 24h TTL
    await redis.sadd("portfolio:snapshots:active_keys", key);
  }
}
```

### 3. NEW: `coreza-backend/src/repositories/LiveFillRepository.ts` (~30 lines)

Batch upsert to `live_fills` table using service-role Supabase client.

```ts
export class LiveFillRepository {
  static async batchUpsert(rows: any[]): Promise<void> {
    const { error } = await supabase
      .from("live_fills")
      .upsert(rows, { onConflict: "user_id,broker,event_id" });
    if (error) throw error;
  }
}
```

### 4. NEW: `coreza-backend/src/repositories/CashSnapshotRepository.ts` (~25 lines)

Batch insert to `cash_snapshots` table.

```ts
export class CashSnapshotRepository {
  static async batchInsert(rows: any[]): Promise<void> {
    const { error } = await supabase
      .from("cash_snapshots")
      .insert(rows);
    if (error) throw error;
  }
}
```

### 5. NEW: `coreza-backend/src/workers/FillSyncWorker.ts` (~200 lines)

Singleton background service modeled on `RunSyncService`. Two loops:

**Fill consumption loop (every tick):**
1. `SMEMBERS portfolio:fills:active_streams` → get all active stream keys
2. For each stream: `XREADGROUP GROUP fill-sync worker-1 COUNT 100 BLOCK 2000`
3. Parse entries, dedupe by `event_id` in-memory
4. Map to `live_fills` row format
5. `LiveFillRepository.batchUpsert(rows)`
6. On success: `XACK` all processed entries
7. On failure: increment retry counter per entry ID. After 5 failures → `XADD portfolio:fills:dlq` and `XACK` original

**Snapshot flush loop (every 5s):**
1. `SMEMBERS portfolio:snapshots:active_keys` → get all snapshot keys
2. For each key: `GET` + `DEL` (atomic via pipeline)
3. Parse JSON, map to `cash_snapshots` row format
4. `CashSnapshotRepository.batchInsert(rows)`

**Lifecycle:**
- `start()`: Create consumer groups (ignore BUSYGROUP), start intervals
- `stop()`: Clear intervals
- `flushAll()`: Process all remaining entries before shutdown

### 6. MODIFIED: `coreza-backend/src/nodes/executors/PortfolioExecutor.ts`

**Add to class:**
- `private orderFillState: Map<string, number> = new Map()` — tracks cumulative filled qty per order
- `computeFillDelta(orderId, currentFilledQty)` — returns `currentFilledQty - previousFilledQty` (delta only)
- `buildFillStreamEvent(...)` — builds `FillStreamEvent` with deterministic `event_id`:
  - Preferred: `params.executionId` (broker execution ID from Alpaca/Binance)
  - Fallback: SHA-256 hash of `(user_id, broker, symbol, order_id, fill_qty_delta, fill_price, event_time)`
  - Never uses `Date.now()` for identity
- `buildLatestSnapshot(pm, metadata)` — builds `LatestSnapshotState` from `getPortfolioSummary()`

**Modify `brokerSyncOrderEvent` signature** (line 410):
```ts
private async brokerSyncOrderEvent(
  pm: PortfolioManager,
  params: any,
  context?: NodeExecutionContext,  // ← ADD
): Promise<NodeResult>
```

**Modify call site** (line 282):
```ts
case "sync_order_event":
  return this.brokerSyncOrderEvent(pm, params, context);  // ← pass context
```

**Add at end of `brokerSyncOrderEvent`** (after line 504, before the return):
```ts
// 5. Buffer fill for async DB persistence (fire-and-forget)
const fillDeltaQty = this.computeFillDelta(brokerOrderId, filledQty);

if (fillDeltaQty > 0 && context?.userId && context?.workflowId) {
  const event = this.buildFillStreamEvent({
    context,
    params,
    symbol,
    side: params.side,
    orderId: brokerOrderId,
    executionId: params.executionId,
    fillDeltaQty,
    fillPrice: avgFillPrice,
    feeAmount,
    feeAsset,
    baseCurrency,
  });

  void FillEventBus.publish(event).catch((err) =>
    logger.warn({ err, eventId: event.event_id }, "fill event append failed")
  );

  // 6. Coalesced snapshot update
  const snapshot = this.buildLatestSnapshot(pm, {
    userId: context.userId,
    workflowId: context.workflowId,
    runId: context.runId,
    broker: params.broker || "binance",
    credentialId: params.credential_id,
    baseCurrency,
  });
  void SnapshotCache.upsertLatest(snapshot).catch((err) =>
    logger.warn({ err }, "snapshot cache update failed")
  );
}
```

### 7. MODIFIED: `coreza-backend/src/workers/index.ts`

Add export:
```ts
export { default as FillSyncWorker } from './FillSyncWorker';
```

### 8. MODIFIED: `coreza-backend/src/index.ts`

Register lifecycle:
```ts
import FillSyncWorker from "./workers/FillSyncWorker";

// In startup (after RunSyncService.start()):
FillSyncWorker.start();

// In shutdown:
FillSyncWorker.stop();
await FillSyncWorker.flushAll();
```

### 9. DATABASE MIGRATION

```sql
-- Add idempotency and workflow tracking columns to live_fills
ALTER TABLE live_fills ADD COLUMN IF NOT EXISTS event_id text;
ALTER TABLE live_fills ADD COLUMN IF NOT EXISTS execution_id text;
ALTER TABLE live_fills ADD COLUMN IF NOT EXISTS workflow_id uuid;
ALTER TABLE live_fills ADD COLUMN IF NOT EXISTS run_id uuid;

-- Create unique constraint for dedup (replaces trade_id-based dedup)
ALTER TABLE live_fills
  ADD CONSTRAINT uq_live_fills_event_id UNIQUE (user_id, broker, event_id);

-- Index for dashboard queries filtered by workflow
CREATE INDEX IF NOT EXISTS idx_live_fills_workflow
  ON live_fills (user_id, workflow_id);

-- Expand cash_snapshots with structured fields
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS workflow_id uuid;
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS run_id uuid;
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS base_currency text;
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS cash numeric;
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS equity numeric;
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS realized_pnl numeric;
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS unrealized_pnl numeric;
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS positions_count integer;
```

---

## Guardrails (Non-Negotiable)

1. No Supabase write from `brokerSyncOrderEvent` — Redis only
2. No stream event unless `fill_qty_delta > 0` — delta detection required
3. No `Date.now()`-based dedup identifiers — deterministic event_id only
4. No snapshot row per order-status event — coalesced via SET, flushed on cadence
5. No XACK before DB success — at-least-once delivery guarantee
6. In-memory trading state remains the source of truth
7. Dashboard tables are read models only

---

## Defaults

| Setting | Value |
|---------|-------|
| Fill stream key | `{userId}:{workflowId}:portfolio:fills:stream` |
| Snapshot key | `{userId}:{workflowId}:portfolio:snapshot:latest` |
| Active streams registry | `portfolio:fills:active_streams` |
| Consumer group | `fill-sync` |
| Batch size | 100 |
| Read block timeout | 2000ms |
| Snapshot flush interval | 5000ms |
| Stream trim | `MAXLEN ~ 100000` |
| Poison-message threshold | 5 retries |
| DLQ stream | `portfolio:fills:dlq` |
| Snapshot TTL | 86400s (24h) |

---

## Files Summary

| File | Action | ~Lines |
|------|--------|--------|
| `src/services/FillEventBus.ts` | New | 50 |
| `src/services/SnapshotCache.ts` | New | 40 |
| `src/repositories/LiveFillRepository.ts` | New | 30 |
| `src/repositories/CashSnapshotRepository.ts` | New | 25 |
| `src/workers/FillSyncWorker.ts` | New | 200 |
| `src/nodes/executors/PortfolioExecutor.ts` | Modified | +60 |
| `src/workers/index.ts` | Modified | +1 |
| `src/index.ts` | Modified | +6 |
| DB migration SQL | New | ~15 |

