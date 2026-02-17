

# InitializeIndicators Node -- QuantConnect-Style SetWarmUp for Coreza

## How QuantConnect's SetWarmUp Works

In QuantConnect, before the algorithm starts live trading, you call `SetWarmUp(N)` in `Initialize()`. This tells the engine:

1. Fetch the last N bars of historical data
2. Feed those bars through ALL registered indicators (EMA, RSI, MACD, etc.) so their internal state is fully populated
3. Set `IsWarmingUp = true` during this phase -- no orders are placed
4. Once warm-up completes, `IsWarmingUp = false`, all indicators have `IsReady = true`, and the algorithm begins trading on new bars

The key insight: warm-up happens ONCE before the loop, not per-bar. Each indicator then only needs 1 new bar per iteration to produce an updated value.

## How This Maps to Coreza

Currently in Coreza, when an Indicator node (RSI, EMA, etc.) runs inside a loop for the first time, it receives ALL bars and calls `stateManager.warmUp()`. On subsequent iterations it calls `stateManager.update()` with just the latest bar. The problem: each indicator node independently warms up when first encountered, and requires `symbol`, `timeframe`, and `candle_data` to be passed through the loop.

The **InitializeIndicators** node will:

1. Sit BEFORE the Loop node (like BacktestInit)
2. Accept candle data + warmup period as input
3. **Auto-discover all indicator nodes in the workflow** by scanning downstream nodes
4. Warm up ALL indicators in one shot using the first N bars
5. Pass the remaining bars (post-warmup) to the Loop node
6. When indicator nodes run inside the loop, they find pre-warmed state in `IndicatorStateManager` and only call `update()` with the single new bar

```text
[Data Source] --> [InitializeIndicators] --> [Loop] --> [RSI] --> [If] --> [Trade]
                                                   --> [EMA] --^
                  Warms up RSI + EMA with              Each iteration: just 1 bar update
                  first N bars from data source         (state already ready)
```

## Implementation Plan

### File 1: `src/nodes/InitializeIndicators.json` (New -- Frontend Node Definition)

```json
{
  "name": "InitializeIndicators",
  "def": "Initialize and warm up all workflow indicators",
  "node_type": "main",
  "icon": "/assets/icons/indicators.svg",
  "category": "Indicators",
  "description": "Warm up all indicators in the workflow with historical data before the loop begins. Similar to QuantConnect's SetWarmUp.",
  "color": "text-purple-500",
  "size": { "width": 340, "height": 380 },
  "handles": [
    { "type": "target", "position": "left", "id": "input" },
    { "type": "source", "position": "right", "id": "output" }
  ],
  "action": { "url": "/indicators/initialize", "method": "POST" },
  "fields": [
    {
      "key": "candle_data",
      "label": "Candle Data",
      "type": "text",
      "description": "Historical OHLCV bar data to warm up indicators",
      "required": true
    },
    {
      "key": "symbol",
      "label": "Symbol",
      "type": "text",
      "placeholder": "e.g. BTCUSDT",
      "required": true
    },
    {
      "key": "timeframe",
      "label": "Timeframe",
      "type": "text",
      "placeholder": "e.g. 1d",
      "required": true
    },
    {
      "key": "warmup_period",
      "label": "Warm-Up Period (bars)",
      "type": "text",
      "placeholder": "200",
      "default": "200",
      "description": "Number of bars to use for warming up indicators. Should be >= the longest indicator period in your workflow.",
      "required": true
    },
    {
      "key": "auto_detect",
      "label": "Auto-Detect Indicators",
      "type": "select",
      "options": [
        { "id": "true", "name": "Yes - Scan workflow for all indicators" },
        { "id": "false", "name": "No - Manual configuration" }
      ],
      "default": "true",
      "required": true
    }
  ]
}
```

### File 2: `coreza-backend/src/nodes/executors/InitializeIndicatorsExecutor.ts` (New -- Backend Executor)

This is the core logic. It will be added to the `IndicatorsExecutor` as a new case (since the category is "Indicators"), or registered as a handler within it.

**Approach:** Add handling for `InitializeIndicators` in `IndicatorsExecutor.execute()`.

Logic:

```typescript
// Inside IndicatorsExecutor.execute(), add case for InitializeIndicators:

if (indicatorType === 'initializeindicators') {
  return this.executeInitializeIndicators(node, input, context);
}
```

**`executeInitializeIndicators` method:**

1. **Parse inputs**: `candle_data`, `symbol`, `timeframe`, `warmup_period`, `auto_detect`

2. **Auto-detect indicators from workflow**:
   - Access `context.nodes` and `context.edges` (already available in executionContext)
   - Find all downstream indicator nodes by walking edges from this node
   - For each indicator node found, extract its type (RSI, EMA, MACD, etc.) and parameters (period, window, etc.) from `node.values`

   ```typescript
   function discoverIndicators(
     startNodeId: string,
     allNodes: WorkflowNode[],
     allEdges: WorkflowEdge[]
   ): Array<{ nodeId: string; type: string; params: Record<string, any> }> {
     const indicators: Array<...> = [];
     const visited = new Set<string>();
     const queue = allEdges
       .filter(e => e.source === startNodeId)
       .map(e => e.target);
     
     while (queue.length > 0) {
       const nodeId = queue.shift()!;
       if (visited.has(nodeId)) continue;
       visited.add(nodeId);
       
       const node = allNodes.find(n => n.id === nodeId);
       if (!node) continue;
       
       // Check if this is an indicator node
       const name = (node.name || '').toUpperCase();
       if (INDICATOR_NAMES.has(name)) {
         indicators.push({
           nodeId: node.id,
           type: (node.name || '').toLowerCase(),
           params: node.values || {},
         });
       }
       
       // Continue BFS through all downstream nodes
       allEdges
         .filter(e => e.source === nodeId)
         .forEach(e => { if (!visited.has(e.target)) queue.push(e.target); });
     }
     return indicators;
   }
   ```

   Where `INDICATOR_NAMES` is:
   ```typescript
   const INDICATOR_NAMES = new Set([
     'RSI', 'EMA', 'SMA', 'MACD', 'BB', 'BOLLINGER BANDS',
     'ADX', 'STOCH', 'VWAP', 'OBV', 'ICHIMOKU',
     'VOLUMEOSCILLATOR', 'SUPPORTRESISTANCE'
   ]);
   ```

3. **Slice bars into warmup vs remaining**:
   ```typescript
   const warmupPeriod = Math.min(parseInt(params.warmup_period) || 200, bars.length);
   const warmupBars = bars.slice(0, warmupPeriod);
   const remainingBars = bars.slice(warmupPeriod);
   ```

4. **Warm up each discovered indicator**:
   ```typescript
   const stateManager = context.indicatorStateManager;
   const results: Record<string, any> = {};
   
   for (const ind of discoveredIndicators) {
     // Merge the indicator's own params (period, window, etc.) with symbol/timeframe
     const indParams = {
       ...ind.params,
       symbol,
       timeframe,
       candle_data: warmupBars,
     };
     
     const key = buildIndicatorKey(
       userId, workflowId, runId,
       symbol, timeframe, ind.type
     );
     
     const state = await stateManager.warmUp(
       key, ind.type, indParams, warmupBars, false
     );
     
     results[ind.type] = {
       nodeId: ind.nodeId,
       indicator: ind.type,
       warmupBars: warmupBars.length,
       isReady: state.warmupCompleted,
       currentValue: state.value,
     };
   }
   ```

5. **Return output** with remaining bars for the Loop node:
   ```typescript
   return toNodeResult(createSuccessOutput({
     warmup_completed: true,
     warmup_bars_used: warmupPeriod,
     remaining_bars: remainingBars,    // <-- Loop node uses these
     remaining_bars_count: remainingBars.length,
     indicators_initialized: Object.keys(results).length,
     indicators: results,
     symbol,
     timeframe,
   }));
   ```

### File 3: `coreza-backend/src/nodes/executors/IndicatorsExecutor.ts` (Modify)

Add the `InitializeIndicators` case and the new method:

- At line 41, after `const indicatorType = ...`, add:
  ```typescript
  if (indicatorType === 'initializeindicators') {
    return this.executeInitializeIndicators(node, input, context);
  }
  ```

- Add the `executeInitializeIndicators` private method (~80 lines) as described above

- Add `discoverIndicators` helper function

### File 4: `coreza-backend/src/services/workflowEngine.ts` (Modify)

Add `InitializeIndicators` to the `CATEGORY_MAP` so the engine routes it to the Indicators executor:

```typescript
const CATEGORY_MAP: Record<string, string> = {
  // ... existing entries ...
  InitializeIndicators: "Indicators",   // <-- add this
};
```

### File 5: `coreza-backend/src/services/toolOutputProcessor.ts` (Modify)

Add `InitializeIndicators` to the `INDICATOR_NODES` array so the tool output processor handles it correctly.

## How It Works End-to-End

### Workflow Layout

```text
[Binance Data] ---> [InitializeIndicators] ---> [Loop] ---> [RSI] ---> [If] ---> [BacktestTrade]
                     warmup_period: 200                       ^
                     auto_detect: true                        |
                                                         [EMA] ----+
```

### Execution Timeline

1. **Binance Data** fetches 1000 bars of BTCUSDT 1d data
2. **InitializeIndicators** receives 1000 bars:
   - Scans workflow, finds RSI (period=14) and EMA (period=20)
   - Uses first 200 bars to warm up both indicators via `IndicatorStateManager`
   - Outputs `remaining_bars` (bars 201-1000 = 800 bars) + warmup summary
3. **Loop** iterates over the 800 remaining bars (1 bar per iteration)
4. **RSI** node runs: `stateManager.getState(key)` finds pre-warmed state, calls `update()` with just the 1 new bar -- O(1) per iteration
5. **EMA** node runs: same -- already warmed, just `update()` with 1 bar
6. **If** checks RSI value, routes to Trade if conditions met

### Key Behavioral Match with QuantConnect

| QuantConnect | Coreza InitializeIndicators |
|---|---|
| `SetWarmUp(TimeSpan.FromDays(200))` | `warmup_period: 200` field |
| Auto-warms all registered indicators | `auto_detect: true` scans workflow for indicator nodes |
| `IsWarmingUp` flag prevents orders | Warmup bars are consumed by the node; Loop only gets post-warmup bars |
| `indicator.IsReady` after warmup | `state.warmupCompleted = true` in IndicatorStateManager |
| Called once in `Initialize()` | Runs once before the Loop node |
| N days of historical data fed through | First N bars sliced and fed through `warmUp()` |

## Files Summary

| File | Action | Description |
|---|---|---|
| `src/nodes/InitializeIndicators.json` | Create | Frontend node definition with fields |
| `coreza-backend/src/nodes/executors/IndicatorsExecutor.ts` | Modify | Add `executeInitializeIndicators` method + `discoverIndicators` helper |
| `coreza-backend/src/services/workflowEngine.ts` | Modify | Add to CATEGORY_MAP |
| `coreza-backend/src/services/toolOutputProcessor.ts` | Modify | Add to INDICATOR_NODES list |

