

# Event-Driven BacktestInit Implementation — COMPLETED

## All 4 fixes from the review have been implemented:

### ✅ Step 1: Fixed `extractStrategySubgraph` (BacktestExecutor.ts)
- Removed root edges from BacktestInit → strategy nodes (fixes dependency blocking)
- Now returns `entryNodeIds: string[]` — the node IDs directly downstream of BacktestInit
- Entry nodes have zero incoming edges in the subgraph context, making them natural starting points

### ✅ Step 2: Added `preloadResults()` and `executeFromEntries()` to WorkflowEngine
- `preloadResults(results)`: Pre-populates store with node results so template expressions resolve
- `executeFromEntries(input, entryNodeIds)`: Multi-entry execution that pre-marks incoming edges and enqueues all entry nodes

### ✅ Step 3: Updated BacktestRunner & BacktestRunnerManager
- Constructor now accepts `entryNodeIds` and `backtestInitResult`
- Each bar iteration: calls `engine.preloadResults()` then `engine.executeFromEntries()` instead of `engine.execute()`
- BacktestRunnerManager passes through the new parameters

### ✅ Step 4: Updated REST route (routes/backtest.ts)
- Added `broker`, `credential_id`, `symbol`, `interval`, `asset_type`, `feed`, `warmup_period`, `auto_detect` to req.body destructuring and node values

## Architecture Summary

| Mode | Event Source | Runner | Reset Method | State Preserved |
|---|---|---|---|---|
| **Non-stream** | BullMQ job | EnginePool | `reset()` | Maps, router, executors |
| **Live stream** | Redis Stream | LiveStrategyRunner | `reset()` | + indicator state |
| **Backtest** | Pipelined XADD | BacktestRunner | `resetLight()` | + DataContext |
