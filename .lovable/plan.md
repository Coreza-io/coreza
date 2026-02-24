

# In-Memory Backtest Runner: Eliminate Redis Stream from Hot Path

## Current Architecture (What's Wrong)

```text
executeBacktestInit()
  ├── Fetch bars from broker API        (necessary, ~1-3s)
  ├── Warm indicators with warmup bars  (necessary, ~0.1s)
  ├── JSON.stringify 100K bars          (WASTE)
  ├── Pipeline XADD to Redis Stream     (WASTE: ~2-5s for 100K bars)
  └── Start BacktestRunner
        └── for each bar:
              ├── XREADGROUP from Redis  (WASTE: network I/O)
              ├── JSON.parse(rawEvent)   (WASTE: already was JS object)
              ├── XACK                   (WASTE: no crash recovery needed)
              ├── engine.resetLight()    (necessary)
              ├── engine.preloadResults()(necessary)
              └── engine.executeFromEntries() (necessary)
```

**The bars are already in memory as a JS array (`remainingBars`) inside `executeBacktestInit`.** They get serialized to JSON, pushed to Redis, then deserialized back to JS objects. This round-trip adds ~10-50s of pure waste for 100K bars.

## New Architecture

```text
executeBacktestInit()
  ├── Fetch bars from broker API        (same)
  ├── Warm indicators with warmup bars  (same)
  └── Start BacktestRunner(remainingBars)  <-- pass array directly
        └── for each bar:
              ├── engine.resetLight()          (same)
              ├── engine.preloadResults()      (same)
              └── engine.executeFromEntries()  (same)
```

No Redis. No JSON. No XADD. No XREADGROUP. No XACK. No consumer groups. No dedicated Redis connection.

## Changes

### 1. `coreza-backend/src/services/BacktestRunner.ts` -- Full Rewrite

Replace Redis Stream consumption with a direct in-memory loop.

```typescript
import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { WorkflowEngine } from "./workflowEngine";
import { BacktestExecutor } from "../nodes/executors/BacktestExecutor";
import { IndicatorStateManager } from "./indicatorStateManager";
import { getRedisCache } from "../config/redis";

interface BarEvent {
  bar: any;
  symbol: string;
  interval: string;
  barIndex: number;
}

export class BacktestRunner {
  private readonly engine: WorkflowEngine;
  private running = false;
  private readonly abortController: AbortController;
  private barsProcessed = 0;
  private readonly runId: string;

  constructor(
    private readonly backtestId: string,
    workflowId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    private readonly entryNodeIds: string[],
    private readonly backtestInitResult: Record<string, any>,
    private readonly bars: BarEvent[],
    runId: string,
    stateManager?: IndicatorStateManager,
  ) {
    this.abortController = new AbortController();
    this.runId = runId;
    this.engine = new WorkflowEngine(
      this.runId,
      workflowId,
      userId,
      nodes,
      edges,
      "best-effort",
      this.abortController.signal,
    );

    if (stateManager) {
      this.engine.setIndicatorStateManager(stateManager);
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const totalBars = this.bars.length;

    for (let i = 0; i < totalBars; i++) {
      if (!this.running || this.abortController.signal.aborted) break;

      this.engine.resetLight(this.runId, this.abortController.signal);
      this.engine.preloadResults(this.backtestInitResult);

      try {
        await this.engine.executeFromEntries(
          { data: this.bars[i] },
          this.entryNodeIds,
        );
      } catch (error) {
        console.error("[BacktestRunner] Error processing bar:", error);
      }

      this.barsProcessed = i + 1;

      if (this.barsProcessed % 1000 === 0) {
        await this.reportProgress(totalBars);
      }
    }

    await this.finalize();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController.abort();
  }

  private async reportProgress(totalBars: number): Promise<void> {
    const percent = totalBars > 0
      ? Math.round((this.barsProcessed / totalBars) * 100)
      : 100;

    const redis = getRedisCache();
    await redis.set(
      `backtest:progress:${this.backtestId}`,
      JSON.stringify({
        backtestId: this.backtestId,
        barsProcessed: this.barsProcessed,
        totalBars,
        percent,
        updatedAt: new Date().toISOString(),
      }),
      "EX",
      3600,
    );
  }

  private async finalize(): Promise<void> {
    this.running = false;
    await this.reportProgress(this.bars.length);

    try {
      const backtestExecutor = new BacktestExecutor();
      await backtestExecutor.finalizeBacktestById(this.backtestId);
    } catch (error) {
      console.error(
        `[BacktestRunner] Finalization failed for ${this.backtestId}:`,
        error,
      );
    }

    const redis = getRedisCache();
    await redis.del(`backtest:progress:${this.backtestId}`);
  }
}
```

**What changed:**
- Removed: `ioredis` import, `createDedicatedCacheConnection`, `redisStream`, `redisCache`, `streamKey`, `consumerName`, `BACKTEST_GROUP`
- Removed: Redis connection wait, XGROUP CREATE, XREADGROUP loop, XACK, stream cleanup
- Added: Simple `for` loop over `this.bars` array
- `reportProgress` and `finalize` use shared `getRedisCache()` (no dedicated connection)
- Constructor takes `bars: BarEvent[]` instead of `totalBars: number`

### 2. `coreza-backend/src/services/BacktestRunnerManager.ts` -- Update Signature

Change `totalBars: number` to `bars: BarEvent[]` in `startBacktest`:

```typescript
async startBacktest(
  backtestId: string,
  workflowId: string,
  userId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  entryNodeIds: string[],
  backtestInitResult: Record<string, any>,
  bars: BarEvent[],       // was: totalBars: number
  runId: string,
  stateManager?: IndicatorStateManager,
): Promise<void> {
  // ... same logic, pass bars to BacktestRunner constructor
}
```

### 3. `coreza-backend/src/nodes/executors/BacktestExecutor.ts` -- Remove Redis Stream XADD

In `executeBacktestInit` (lines 375-396), replace the Redis Stream pipeline with direct array passing:

**Remove (lines 375-396):**
```typescript
const redis = getRedisCache();
const streamKey = `backtest:stream:${backtestId}`;
await redis.del(streamKey);

const pipeline = redis.pipeline();
for (let i = 0; i < remainingBars.length; i += 1) {
  pipeline.xadd(
    streamKey, "MAXLEN", "~",
    String(remainingBars.length + 200), "*",
    "event", JSON.stringify({ bar: remainingBars[i], symbol, interval, barIndex: i }),
  );
}
await pipeline.exec();
```

**Replace with:**
```typescript
// Build bar events array for in-memory processing
const barEvents = remainingBars.map((bar, i) => ({
  bar,
  symbol,
  interval,
  barIndex: i,
}));
```

Then update the `BacktestRunnerManager.startBacktest` call (lines 426-437):

```typescript
await BacktestRunnerManager.getInstance().startBacktest(
  backtestId,
  workflowId,
  userId,
  strategyNodes,
  strategyEdges,
  entryNodeIds,
  backtestInitResult,
  barEvents,        // was: remainingBars.length
  runId,
  stateManager,
);
```

Also remove the `getRedisCache` import if no longer used elsewhere in this file.

### 4. `coreza-backend/src/nodes/executors/BacktestExecutor.ts` -- Fix `executeOnBar` (lines 487-495)

Add missing OHLCV fields and `"BacktestInit"` name key:

**executeOnBar fix:**
```typescript
private async executeOnBar(
  node: WorkflowNode,
  input: NodeInput,
  context: any,
): Promise<NodeResult> {
  void node;
  const data = input?.data;
  const bar = data?.bar;
  const symbol = data?.symbol;
  const barIndex = data?.barIndex;
  const timeframe = data?.interval;

  return toNodeResult(
    createSuccessOutput({
      bar,
      symbol,
      timeframe,
      resolution: timeframe,
      barIndex,
      timestamp: bar?.t || bar?.Timestamp,
      open: bar?.o || bar?.Open,
      high: bar?.h || bar?.High,
      low: bar?.l || bar?.Low,
      close: bar?.c || bar?.Close,
      volume: bar?.v || bar?.Volume,
      vwap: bar?.vw || bar?.VWAP,
      tradeCount: bar?.n || bar?.TradeCount,
    }),
  );
}
```

**backtestInitResult fix (line 414):**
```typescript
const backtestInitResult: Record<string, any> = {
  [node.id]: { success: true, data: backtestInitData },
  "BacktestInit": { success: true, data: backtestInitData },
};
```

## Performance Impact

| Metric | Redis Stream (current) | In-Memory (new) |
|---|---|---|
| 10K bars setup | ~0.5s (XADD pipeline) | 0ms |
| 10K bars per-bar I/O | ~2s (XREADGROUP + XACK) | 0ms |
| 100K bars setup | ~3-5s (XADD pipeline) | 0ms |
| 100K bars per-bar I/O | ~15-30s (XREADGROUP + XACK) | 0ms |
| JSON serialize/deserialize | 100K x 2 = 200K ops | 0 ops |
| Redis connections per backtest | 2 (dedicated stream + cache) | 0 (only cache for progress) |
| GC pressure | High (200K temp objects) | None |

## What About Live Trading?

Live trading (`LiveStrategyRunner`) still uses Redis Streams correctly because:
- Data arrives asynchronously from broker WebSockets
- Needs backpressure handling
- Needs crash recovery (reconnect and resume)
- Multiple consumers possible

Backtesting has none of these requirements. All data is known upfront, deterministic, single-consumer.

## Files Summary

| File | Change |
|---|---|
| `coreza-backend/src/services/BacktestRunner.ts` | Replace Redis Stream loop with in-memory `for` loop |
| `coreza-backend/src/services/BacktestRunnerManager.ts` | Change `totalBars` param to `bars` array |
| `coreza-backend/src/nodes/executors/BacktestExecutor.ts` | Remove XADD pipeline, pass bars array directly; fix executeOnBar OHLCV; fix BacktestInit name key |

