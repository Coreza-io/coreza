

# Hybrid Architecture: Warm Pool + Long-Lived Strategy Runner

## Overview

Use **two execution models** based on workflow trigger type:

- **Non-stream workflows** (manual, scheduled, webhook, backtest): Keep per-event BullMQ jobs but reuse WorkflowEngine instances via a warm pool (Option A)
- **Stream workflows** (market_data from streaming nodes): One long-lived BullMQ job per workflow that consumes events from a Redis Stream (Option B)

```text
                     +-- manual/scheduled/webhook/backtest -->  [Warm Engine Pool]
                     |       BullMQ job per trigger              Reuse engine instance
  Workflow Trigger --+                                           Reset state per run
                     |
                     +-- market_data (streaming nodes) -------> [Live Strategy Runner]
                            One BullMQ job per workflow          XADD events to Redis Stream
                            Stays alive, consumes events         Engine lives in memory
                            via XREAD BLOCK loop
```

---

## Part 1: Warm Engine Pool (Non-Stream Workflows)

### File 1 (NEW): `coreza-backend/src/services/EnginePool.ts`

A singleton Map cache of warm WorkflowEngine instances keyed by `workflowId`.

- `getOrCreate(workflowId, nodes, edges, userId)`: Returns cached engine or creates new one
- `evict(workflowId)`: Removes engine from cache
- TTL-based cleanup: Engines idle for >5 minutes are evicted automatically (setInterval every 60s)
- Cache stores: `{ engine: WorkflowEngine, lastUsed: number }`

```typescript
class EnginePool {
  private static instance: EnginePool;
  private cache = new Map<string, { engine: WorkflowEngine; lastUsed: number }>();
  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutes

  getOrCreate(workflowId, runId, userId, nodes, edges, opts): WorkflowEngine {
    const cached = this.cache.get(workflowId);
    if (cached) {
      cached.engine.reset(runId);  // Reset execution state, keep maps/router
      cached.lastUsed = Date.now();
      return cached.engine;
    }
    const engine = new WorkflowEngine(runId, workflowId, userId, nodes, edges, opts.mode, opts.abortSignal);
    this.cache.set(workflowId, { engine, lastUsed: Date.now() });
    return engine;
  }
}
```

### File 2 (MODIFY): `coreza-backend/src/services/workflowEngine.ts`

Add a `reset(newRunId)` method to WorkflowEngine:

```typescript
reset(newRunId: string): void {
  this.runId = newRunId;
  this.edgePayload.clear();
  this.failed.clear();
  this.failedNodeErrors.clear();
  this.enqueuedKeys.clear();
  this.retryCount.clear();
  this.executionOrder = [];
  this.queue = new NodeQueueManager();
  if (this.silent) this.queue.silent = true;
  this.store = new NodeStoreV2(newRunId, this.nodes);
  this.dataContext = DataContextManager.getInstance().getContext({
    runId: newRunId, workflowId: this.workflowId, userId: this.userId,
  });
  // Keep: nodeById, incomingEdgesByTarget, outgoingEdgesBySource, router, executors, _nodeHasTemplatesCache
}
```

What is preserved (the expensive stuff):
- `nodeById` Map (built from node array)
- `incomingEdgesByTarget` / `outgoingEdgesBySource` Maps (built from edge array)
- `NodeRouter` instance
- `executors` Map (executor instances with their internal caches, e.g., SimBroker cache, indicator cache)
- `_nodeHasTemplatesCache` (template detection results)

What is reset (per-run state):
- `edgePayload`, `failed`, `failedNodeErrors`, `enqueuedKeys`, `retryCount`
- `executionOrder`
- `NodeQueueManager` (fresh queue)
- `NodeStoreV2` (fresh results store)
- `DataContext` (fresh execution-scoped RAM)

### File 3 (MODIFY): `coreza-backend/src/utils/workflowWorker.ts`

In the normal workflow execution path (line 488), for non-stream triggers, use EnginePool:

```typescript
// Normal workflow execution (line 456+)
if (trigger !== "market_data") {
  // Use warm engine pool for non-stream workflows
  const engine = EnginePool.getInstance().getOrCreate(
    workflowId, runId, userId, nodes, edges, { mode: "best-effort", abortSignal: signal }
  );
  const result = await engine.execute(renamed, startNodeId);
  // ... rest of success/error handling unchanged
}
```

For `trigger === "market_data"`, the worker won't handle it here anymore -- it goes through the Live Strategy Runner (Part 2).

---

## Part 2: Long-Lived Strategy Runner (Stream Workflows)

### File 4 (NEW): `coreza-backend/src/services/LiveStrategyRunner.ts`

The core long-lived execution engine for streaming workflows.

```typescript
class LiveStrategyRunner {
  private engine: WorkflowEngine;
  private redisStream: Redis;     // For XREAD
  private streamKey: string;      // "strategy:stream:{workflowId}"
  private running = false;
  private abortController: AbortController;

  constructor(workflowId, userId, nodes, edges) {
    this.engine = new WorkflowEngine(runId, workflowId, userId, nodes, edges);
    this.streamKey = `strategy:stream:${workflowId}`;
    this.abortController = new AbortController();
  }

  async start(): Promise<void> {
    this.running = true;
    // Create consumer group (if not exists)
    await this.redisStream.xgroup("CREATE", this.streamKey, "strategy-group", "0", "MKSTREAM").catch(() => {});

    while (this.running) {
      // Block-read from Redis Stream (5 second timeout)
      const results = await this.redisStream.xreadgroup(
        "GROUP", "strategy-group", `consumer-${this.engine.workflowId}`,
        "BLOCK", 5000,
        "COUNT", 10,  // Process up to 10 events per batch
        "STREAMS", this.streamKey, ">"
      );

      if (!results || results.length === 0) continue;

      for (const [, messages] of results) {
        for (const [messageId, fields] of messages) {
          const event = JSON.parse(fields[1]); // Parse event data
          const runId = uuidv4();

          // Reset engine for new event (reuse all maps/router/executors)
          this.engine.reset(runId);

          try {
            await this.engine.execute({ data: event });
          } catch (err) {
            console.error(`[LiveStrategy] Error processing event:`, err);
          }

          // Acknowledge message
          await this.redisStream.xack(this.streamKey, "strategy-group", messageId);
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController.abort();
  }
}
```

Key design decisions:
- Uses **Redis Streams** (XREADGROUP with consumer groups) instead of Pub/Sub for durability and ordered processing
- **Block-reads** with 5s timeout so the loop doesn't spin
- **Acknowledges** each message after processing (at-least-once delivery)
- Engine is **reused** across all events (same `reset()` as Option A)
- Indicator state, executor caches (SimBroker, etc.) persist in memory across ticks

### File 5 (NEW): `coreza-backend/src/services/liveStrategyManager.ts`

Manages the lifecycle of all active LiveStrategyRunners.

```typescript
class LiveStrategyManager {
  private static instance: LiveStrategyManager;
  private runners = new Map<string, LiveStrategyRunner>(); // workflowId -> runner

  async startStrategy(workflowId, userId, nodes, edges): Promise<void> {
    if (this.runners.has(workflowId)) return; // Already running

    const runner = new LiveStrategyRunner(workflowId, userId, nodes, edges);
    this.runners.set(workflowId, runner);

    // Start in background (don't await -- it's an infinite loop)
    runner.start().catch(err => {
      console.error(`[LiveStrategyManager] Strategy ${workflowId} crashed:`, err);
      this.runners.delete(workflowId);
    });
  }

  async stopStrategy(workflowId: string): Promise<void> {
    const runner = this.runners.get(workflowId);
    if (runner) {
      await runner.stop();
      this.runners.delete(workflowId);
    }
  }

  isRunning(workflowId: string): boolean {
    return this.runners.has(workflowId);
  }

  async stopAll(): Promise<void> {
    for (const [id, runner] of this.runners) {
      await runner.stop();
    }
    this.runners.clear();
  }
}
```

### File 6 (MODIFY): `coreza-backend/market-stream-service/src/services/MarketDataSubscriber.ts`

Change `triggerWorkflowExecution()` (line 437) to use Redis Stream XADD instead of BullMQ job:

**Before** (current):
```typescript
await bullMqJobQueue.addWorkflowExecution({ runId, workflowId, userId, nodes, edges, trigger: "market_data", ... });
```

**After**:
```typescript
// Push event to Redis Stream (LiveStrategyRunner consumes via XREADGROUP)
const streamKey = `strategy:stream:${workflowId}`;
const redis = getRedisCache();
await redis.xadd(streamKey, "MAXLEN", "~", "1000", "*",
  "event", JSON.stringify(formattedPayload)
);
```

This eliminates:
- BullMQ job creation per tick (no enqueue/dequeue overhead)
- Redis HSET for run metadata per tick
- Redis LPUSH to pending sync list per tick

The stream is capped at ~1000 messages to prevent unbounded growth.

### File 7 (MODIFY): `coreza-backend/src/services/jobQueueManager.ts`

Add methods to manage live strategies:

```typescript
// In BullMQJobQueue class:

async startLiveStrategy(workflowId: string, userId: string, nodes: any[], edges: any[]): Promise<void> {
  const manager = LiveStrategyManager.getInstance();
  await manager.startStrategy(workflowId, userId, nodes, edges);
}

async stopLiveStrategy(workflowId: string): Promise<void> {
  const manager = LiveStrategyManager.getInstance();
  await manager.stopStrategy(workflowId);
}
```

Update `cancelWorkflowJobs()` to also stop live strategies:
```typescript
async cancelWorkflowJobs(userId, workflowId): Promise<number> {
  // ... existing BullMQ cancellation ...
  // Also stop live strategy if running
  const manager = LiveStrategyManager.getInstance();
  if (manager.isRunning(workflowId)) {
    await manager.stopStrategy(workflowId);
    cancelledCount++;
  }
  return cancelledCount;
}
```

### File 8 (MODIFY): `coreza-backend/src/services/GracefulShutdownHandler.ts`

Register LiveStrategyManager for graceful shutdown:

```typescript
// In shutdown sequence:
await LiveStrategyManager.getInstance().stopAll();
```

---

## How Strategies Get Started

When a user activates a workflow that contains a streaming node:

1. The stream node execution (via MarketExecutor) calls `MarketDataSubscriber.registerWorkflow()`
2. **New**: After registration, it also calls `LiveStrategyManager.startStrategy(workflowId, userId, nodes, edges)`
3. The LiveStrategyRunner starts its XREAD loop
4. MarketDataSubscriber's message handler now does `XADD` to the stream instead of `addWorkflowExecution()`
5. LiveStrategyRunner picks up events, resets engine, executes

For non-stream workflows (manual run, scheduled, webhook):
1. `addWorkflowExecution()` is called as before
2. BullMQ worker picks up the job
3. Worker uses `EnginePool.getOrCreate()` instead of `new WorkflowEngine()`
4. Engine is reset and reused on next trigger

---

## Data Flow Comparison

```text
NON-STREAM (webhook/scheduled/manual):
  Trigger --> BullMQ.addWorkflowExecution() --> Worker --> EnginePool.getOrCreate() --> engine.reset() --> engine.execute()
                                                          [reuses maps, router, executors]

STREAM (market_data):
  MarketEvent --> Redis Pub/Sub --> MarketDataSubscriber --> XADD to Redis Stream
                                                                    |
  LiveStrategyRunner (long-lived) <-- XREADGROUP BLOCK <------------+
       |
       engine.reset(newRunId) --> engine.execute(event)
       [engine lives in memory, indicator state preserved, executor caches warm]
```

---

## Files Summary

| File | Type | Purpose |
|---|---|---|
| `coreza-backend/src/services/EnginePool.ts` | NEW | Warm engine cache for non-stream workflows |
| `coreza-backend/src/services/LiveStrategyRunner.ts` | NEW | Long-lived event loop for stream workflows |
| `coreza-backend/src/services/liveStrategyManager.ts` | NEW | Manages lifecycle of all LiveStrategyRunners |
| `coreza-backend/src/services/workflowEngine.ts` | MODIFY | Add `reset()` method (shared by both options) |
| `coreza-backend/src/utils/workflowWorker.ts` | MODIFY | Use EnginePool for non-stream triggers |
| `coreza-backend/market-stream-service/src/services/MarketDataSubscriber.ts` | MODIFY | XADD to Redis Stream instead of BullMQ job |
| `coreza-backend/src/services/jobQueueManager.ts` | MODIFY | Add startLiveStrategy/stopLiveStrategy, update cancel |
| `coreza-backend/src/services/GracefulShutdownHandler.ts` | MODIFY | Register LiveStrategyManager for shutdown |

---

## Per-Tick Overhead Comparison

| Metric | Current (all workflows) | Non-Stream (Pool) | Stream (Long-Lived) |
|---|---|---|---|
| BullMQ jobs per tick | 1 | 1 | 0 |
| Redis writes per tick | 3 (HSET + LPUSH + BullMQ) | 3 | 1 (XADD only) |
| Engine construction | Full rebuild | Reuse (reset only) | Reuse (reset only) |
| Indicator state | Lost between ticks | Lost between ticks | Preserved in memory |
| Executor caches | Lost between ticks | Preserved (warm pool) | Preserved (in-memory) |

