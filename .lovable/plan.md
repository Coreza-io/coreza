

# Analysis: Why Live/Streaming Workflow Executions Don't Appear in Execution History

## Root Cause

**`WorkflowRunner` never creates `workflow_runs` records.** That's it.

### How non-streaming executions persist

For webhook/scheduled/manual workflows, the flow is:

1. `jobQueueManager.ts` or `WebhookService.ts` or `scheduledWorkflowWorker.ts` **creates a `workflow_runs` row** in Supabase (or Redis via `createRunInRedis`)
2. `workflowWorker.ts` **updates the row** with status/result when done
3. `RunSyncService` periodically syncs Redis-stored runs to Supabase
4. Frontend queries `workflow_runs` table in `useExecutionHistory.ts`

### How streaming executions work

1. `jobQueueManager.startWorkflowRunner()` (line 287-291) creates a `WorkflowRunner` and calls `manager.startStrategy()`
2. `WorkflowRunner.start()` enters a `while(running)` loop reading from Redis stream `strategy:stream:{workflowId}`
3. For each event: `engine.resetForNextBar()` → `engine.execute({ data: event })`
4. **No run record is ever created** — not in Supabase, not in Redis
5. Result is discarded — the `execute()` return value is not captured or stored

So the `WorkflowRunner` is effectively a "fire and forget" event processor. It processes every stream event but never records that it did so.

### Why frontend shows nothing

`useExecutionHistory.ts` queries `supabase.from("workflow_runs").select("*").eq("workflow_id", workflowId)`. Since no rows exist for streaming executions, the list is empty. The realtime subscription on `workflow_runs` also gets no inserts.

## What Needs to Change

### Option A: Per-Event Run Records (shows every execution)

For each stream event, create a lightweight run record:
- Before `engine.execute()`: create run in Redis via `createRunInRedis(eventRunId, workflowId, userId)`
- After `engine.execute()`: update status via `updateRunStatusInRedis(eventRunId, 'success', { result })`
- `RunSyncService` (already running) handles the batch sync to Supabase every 10s

This uses the existing Redis-first pattern built exactly for this high-frequency scenario.

### Option B: Batched Summary Records (lighter weight)

Instead of per-event records, periodically (every N events or every N seconds) write a summary record containing event count, last result, errors, etc.

### Recommendation: Option A with throttling

Use Option A (per-event records) but with a configurable throttle to avoid overwhelming Redis/Supabase for very high-frequency streams:

- Default: record every event
- High-frequency mode: record every Nth event or every N seconds

## Implementation Plan

### File: `coreza-backend/src/services/WorkflowRunner.ts`

**Change 1: Import Redis run storage utilities**
```typescript
import { createRunInRedis, updateRunStatusInRedis } from "../utils/redisRunStorage";
```

**Change 2: Create and update run records in the event loop**

In the `start()` method, around lines 76-85, wrap each event execution with run persistence:

```typescript
for (const [messageId, fields] of messages) {
  // ... existing event parsing ...

  const eventRunId = randomUUID();
  await createRunInRedis(eventRunId, this.workflowId, this.userId);

  this.engine.resetForNextBar(true);

  try {
    const event = JSON.parse(rawEvent);
    const result = await this.engine.execute({ data: event?.data ?? event });

    await updateRunStatusInRedis(eventRunId, 'success', {
      result: {
        success: true,
        data: result,
        meta: {
          source: 'stream',
          timestamp: new Date().toISOString(),
          streamMessageId: messageId,
        }
      }
    });
  } catch (error) {
    await updateRunStatusInRedis(eventRunId, 'failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    console.error("[WorkflowRunner] Error processing stream event:", error);
  }

  await this.redisStream.xack(this.streamKey, STRATEGY_GROUP, messageId);
}
```

**Change 3: Add workflow snapshot data**

The `workflow_runs` table expects `nodes`, `edges`, `node_count`, `edge_count` (per the memory about execution history snapshots). Either:
- Store the snapshot once at `WorkflowRunner` construction and pass it to `createRunInRedis`
- Or extend `createRunInRedis` to accept optional snapshot fields

Since all events in one runner use the same workflow definition, store the snapshot once and reuse it.

### File: `coreza-backend/src/utils/redisRunStorage.ts`

**Change 4: Extend `createRunInRedis` to support optional snapshot fields**

Add optional parameters for `nodes`, `edges`, `node_count`, `edge_count` so streaming runs include the workflow snapshot. Also add a `source` field to distinguish stream runs from other types.

### File: `coreza-backend/src/workers/RunSyncService.ts`

**Change 5: Include snapshot fields in sync**

Update the `runsToInsert` mapping (line 136) to include `nodes`, `edges`, `node_count`, `edge_count` if they exist in the Redis hash, so the Supabase upsert carries the snapshot.

## Performance Considerations

- At 500+ symbols streaming, this could produce thousands of run records per minute
- The existing Redis-first + `RunSyncService` batch pattern was designed for exactly this volume
- Redis hash + lpush is ~0.1ms per event — negligible vs execution time
- Supabase batch upsert every 10s handles the persistence
- If volume is too high, add a configurable `recordEveryNthEvent` option to `WorkflowRunner`

## What This Does NOT Change

- Backtest execution history (already works)
- Webhook/scheduled execution history (already works)
- Frontend `useExecutionHistory.ts` (already queries `workflow_runs` — will automatically show new records)
- Realtime subscription (already listens for inserts on `workflow_runs` — will fire for synced records)

