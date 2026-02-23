

# Review: Event-Driven BacktestInit Implementation

## Status: 2 Critical Issues, 2 Medium Issues, Implementation Otherwise Solid

The BacktestInit.json, BacktestRunner, BacktestRunnerManager, workflowEngine.resetLight(), GracefulShutdownHandler integration, and jobQueueManager integration are all well-implemented. However, the BacktestRunner cannot actually execute the strategy subgraph due to two fundamental issues in how the WorkflowEngine processes it.

---

## Critical Issue 1: Strategy subgraph entry nodes are never found

The `BacktestRunner` creates a `WorkflowEngine` with the strategy subgraph (BacktestPortfolio, indicators, If/Switch, Trade nodes) and calls `engine.execute({ data: bar })` without a `startNodeId`.

Inside `WorkflowEngine.run()`, the engine looks for entry nodes filtered by:
```text
node_type === "trigger" || node_type === "backtest"
```

The strategy subgraph contains **none** of these types -- its nodes are indicators, portfolio, trade, control-flow, etc. So the queue stays empty and **nothing executes**.

### Fix

The BacktestRunner needs to identify the "first" strategy nodes (the ones directly connected to BacktestInit's output edge) and pass one as `startNodeId` to `engine.execute()`. But this alone isn't enough due to Issue 2.

The better fix: modify the strategy subgraph extraction to add a **synthetic entry node** -- a lightweight pass-through trigger node that receives the bar data and routes it to the first real strategy nodes. Or, modify `WorkflowEngine.run()` to handle a new entry mode where nodes with no valid incoming source are treated as entry points.

**Recommended approach**: Add a `startNodeIds` parameter (or use `startNodeId` for the first strategy node) and pre-mark all incoming edge payloads from the excluded BacktestInit. This already works when `startNodeId` is provided (lines 610-621 in workflowEngine.ts), but only for a single entry point. If the strategy subgraph has multiple roots (e.g., BacktestInit connects to both BacktestPortfolio AND an indicator node), all of them need to be enqueued.

**Implementation**:
1. In `extractStrategySubgraph()`, also return `entryNodeIds` -- the node IDs directly connected to BacktestInit's output
2. Store these on the BacktestRunner
3. In `BacktestRunner.start()`, call `engine.execute(barData, firstEntryNodeId)` and also manually enqueue the other entry nodes

Or more cleanly: add a `executeFromEntries(input, entryNodeIds)` method on WorkflowEngine that pre-marks all incoming edges for the given entry nodes and enqueues them all.

---

## Critical Issue 2: `backtest_id` doesn't flow to downstream strategy nodes

Downstream nodes like `BacktestTrade` and `BacktestPortfolio` read `params.backtest_id` which resolves from either:
- `node.values.backtest_id` (a template like `{{ $('BacktestInit').json.backtest_id }}`)
- Direct input

In the BacktestRunner:
- The input per bar is just `{ data: bar }` -- no `backtest_id`
- The template `{{ $('BacktestInit').json.backtest_id }}` won't resolve because BacktestInit's output isn't in the new engine's NodeStore (BacktestInit was excluded from the subgraph)

**Result**: Every BacktestTrade and BacktestPortfolio call fails with "backtest_id is required".

### Fix

Two options:

**Option A (Simple)**: Before each `engine.execute()` call in BacktestRunner, pre-populate the engine's store with BacktestInit's result so templates resolve:
```text
engine.store.setNodeResult(backtestInitNodeId, {
  success: true,
  data: { backtest_id: backtestId, symbol, ... }
});
```
This requires either exposing `store.setNodeResult()` publicly or adding a method like `engine.preloadNodeResult(nodeId, result)`.

**Option B (Cleaner)**: Include the `backtest_id` in the bar event data passed to `execute()`, and modify the subgraph nodes' values to reference it from input. But this requires changing how users configure BacktestTrade/Portfolio nodes.

**Recommended: Option A** -- it's transparent and doesn't require users to change their workflow configuration. Add a `preloadResults(results: Record<string, any>)` method on WorkflowEngine.

---

## Medium Issue 1: `extractStrategySubgraph` includes root edges that break dependency checks

The function includes edges from BacktestInit to the first strategy nodes:
```text
const rootEdges = allEdges.filter(
  (edge) => edge.source === backtestNodeId && visited.has(edge.target),
);
```

These edges have `source === backtestNodeId`, but BacktestInit is NOT in the subgraph's node list. When `areDependenciesSatisfied()` checks incoming edges for the first strategy nodes, it finds these root edges, checks `isSubNode(backtestNodeId)` which returns `false` (node not found), so they become "required" edges that will never have payloads. The first strategy nodes are **permanently blocked**.

### Fix

Do NOT include the root edges (from BacktestInit to strategy nodes) in the subgraph edges. Instead, the first strategy nodes should have zero incoming edges in the subgraph context, making them natural entry points. Or handle this via the `startNodeId` / pre-marking approach from Issue 1.

---

## Medium Issue 2: Route `/backtest/init` doesn't pass required context

The REST route `POST /backtest/init` (in `routes/backtest.ts`) calls `backtestExecutor.execute()` with context:
```text
{ userId, workflowId: workflow_id }
```

But `executeBacktestInit` now needs:
- `context.nodes` -- for indicator discovery and subgraph extraction
- `context.edges` -- same
- `context.indicatorStateManager` -- for warmup
- `context.internalToken` -- for the internal broker HTTP call

When called via the REST route (not via WorkflowEngine), these are all undefined/empty. The indicator warmup silently skips (because `allNodes` is empty), the subgraph extraction returns zero nodes, and the internal broker HTTP call has no auth token.

### Fix

The REST route should either:
1. Fetch the workflow's nodes/edges from Supabase and pass them in context
2. Or document that the REST route is a simplified init-only path (no data fetch, no warmup, no event emission) and the full event-driven flow only works when triggered via WorkflowEngine

Option 2 is pragmatic -- the REST route was the old API path. The new event-driven flow runs through the workflow engine. Add the new fields (`broker`, `symbol`, `interval`, etc.) to the destructured `req.body` so they at least get stored, even if the full pipeline doesn't run via REST.

---

## What's Working Well

| Component | Status | Notes |
|---|---|---|
| BacktestInit.json | Good | All fields present with correct displayOptions |
| BacktestRunner.ts | Good | Dedicated Redis connection, non-blocking XREAD, progress reporting, auto-finalize, proper cleanup |
| BacktestRunnerManager.ts | Good | Singleton, fire-and-forget with crash handling, proper cleanup in finally |
| workflowEngine.resetLight() | Good | Preserves DataContext, indicatorStateManager, executors |
| extractStrategySubgraph() | Mostly good | BFS logic correct, but root edge inclusion causes issues (see Medium Issue 1) |
| GracefulShutdownHandler | Good | BacktestRunnerManager.stopAll() registered |
| jobQueueManager | Good | startBacktest/stopBacktest methods, cancelWorkflowJobs integration with Supabase lookup |
| SimBroker cache (static) | Good | Cross-engine singleton access works correctly |
| BacktestExecutor 3-phase init | Good | Fetch, warmup, emit logic is sound |
| Pipelined XADD | Good | Efficient bulk write with MAXLEN cap |

---

## Implementation Plan (Fixes)

### Step 1: Fix subgraph extraction (remove root edges, return entry node IDs)

Modify `extractStrategySubgraph()` in `BacktestExecutor.ts`:
- Do NOT include edges from BacktestInit in the returned edges
- Return a third field: `entryNodeIds: string[]` -- the node IDs directly downstream of BacktestInit

### Step 2: Add `preloadResults()` and multi-entry execution to WorkflowEngine

Add two methods to `WorkflowEngine`:
- `preloadResults(results: Record<string, any>)` -- sets node results into the store so templates can resolve
- `executeFromEntries(input, entryNodeIds)` -- enqueues multiple entry nodes with pre-marked edge payloads

### Step 3: Update BacktestRunner to use new methods

In `BacktestRunner`:
- After creating the engine, call `engine.preloadResults()` with BacktestInit's output (backtest_id, symbol, config, etc.)
- Call `engine.executeFromEntries(barData, entryNodeIds)` instead of `engine.execute(barData)`

This requires passing `backtestInitNodeId`, `backtestInitResult`, and `entryNodeIds` from `BacktestExecutor` to `BacktestRunner` (via constructor or the manager).

### Step 4: Update REST route

Add the new fields (`broker`, `symbol`, `interval`, etc.) to the route's `req.body` destructuring so they're stored in `node.values`. The full event-driven pipeline won't run via REST (no nodes/edges context), but the basic init will still work for API consumers.

---

## Technical Details

### Modified `extractStrategySubgraph` signature:
```text
function extractStrategySubgraph(
  backtestNodeId, allNodes, allEdges
): {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];      // edges BETWEEN strategy nodes only
  entryNodeIds: string[];      // first nodes after BacktestInit
}
```

### New `WorkflowEngine` methods:
```text
preloadResults(results: Record<string, any>): void
  -- calls this.store.setNodeResult(nodeId, result) for each entry

executeFromEntries(input: any, entryNodeIds: string[]): Promise<...>
  -- for each entryNodeId: pre-mark incoming edge payloads, enqueue
  -- then run the main processing loop
```

### Updated `BacktestRunner` constructor:
```text
constructor(
  backtestId, workflowId, userId,
  nodes, edges,
  entryNodeIds: string[],           // NEW
  backtestInitResult: Record<string, any>,  // NEW (nodeId -> result)
  totalBars
)
```

### Updated `BacktestRunnerManager.startBacktest`:
```text
async startBacktest(
  backtestId, workflowId, userId,
  nodes, edges,
  entryNodeIds: string[],
  backtestInitResult: Record<string, any>,
  totalBars
)
```

### Files to modify:

| File | Change |
|---|---|
| `coreza-backend/src/nodes/executors/BacktestExecutor.ts` | Fix `extractStrategySubgraph` return type; pass entryNodeIds + backtestInitResult to runner |
| `coreza-backend/src/services/workflowEngine.ts` | Add `preloadResults()` and `executeFromEntries()` methods |
| `coreza-backend/src/services/BacktestRunner.ts` | Accept entryNodeIds + backtestInitResult; use new engine methods |
| `coreza-backend/src/services/BacktestRunnerManager.ts` | Pass through new parameters |
| `coreza-backend/src/routes/backtest.ts` | Add new fields to req.body destructuring |

