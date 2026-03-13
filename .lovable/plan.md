# Backtest Performance Analysis & Optimization Plan

## Analysis

136,296 bars across 30 nodes. Total wall time ≈ **460 seconds** (7.7 min). Per-bar cost ≈ 3.4ms.

### Top offenders by total time


| Node                     | Avg (ms)  | Total (s) | % of total |
| ------------------------ | --------- | --------- | ---------- |
| **RollingWindow**        | 0.51      | 69.5      | 15.1%      |
| **RollingWindow1**       | 0.47      | 63.8      | 13.9%      |
| **Bollinger Bands**      | 0.33      | 45.3      | 9.8%       |
| **VolumeOscillator**     | 0.33      | 44.5      | 9.7%       |
| **updatePortfolioValue** | 0.27      | 37.0      | 8.0%       |
| **OnBar**                | 0.21      | 28.4      | 6.2%       |
| **getPosition**          | 0.19      | 25.2      | 5.5%       |
| Compute nodes (7×)       | 0.14-0.17 | ~150      | 32.6%      |


### Root causes

**1. RollingWindow (29% combined)** — The biggest problem. Each call:

- Calls `buildExecutionScopedKey()` to construct a string key
- Calls `dataContext.getDataByKey()` to retrieve window
- Parses `candle_data` (JSON.parse or type checks)
- Spreads entire window into a new array: `[...window.values()]` — **O(window_size)** copy every bar
- Constructs a full result object with `latest`, `count`, `isReady`, `remaining`

For a window size of, say, 50 — that's 50-element array copy × 136K bars × 2 windows = **13.6M array copies**.

**2. Indicators (Bollinger, VolumeOsc — 19.5%)** — The `IndicatorsExecutor` on every call:

- Parses `candle_data` (JSON.parse or Array.isArray checks)
- Calls `buildIndicatorKey()` (string concatenation)
- Calls `stateManager.getState()` (Map lookup + possible async)
- Calls `stateManager.update()` (async)
- Wraps result through `normalizeOutput()` + `toNodeResult()`

The actual indicator math is O(1), but the executor overhead dominates.

**4. Portfolio operations (13.5%)** — `updatePortfolioValue` and `getPosition` call `resolveNodeParameters`, parse `current_bar` via `parseBar()`, look up SimBroker instance, and wrap results — every single bar.

## Optimization Plan

### Phase 1: Quick wins (est. -30-40% total time)

**1a. Eliminate RollingWindow array copy** — `[...window.values()]` creates a new array every bar. Instead, return the buffer reference directly (or a lightweight proxy). The downstream nodes only need `latest and previous` and `isReady` most of the time.


| File                               | Change                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `DataSourceExecutor.ts` (line 266) | Replace `window: [...window.values()]` with `window: window.values()` (returns readonly ref). Only spread when explicitly needed. |


**1b. Cache `buildExecutionScopedKey` result** — The key inputs (userId, workflowId, runId, nodeId, symbol, timeframe) never change within a backtest. Cache the computed key on first call.


| File                    | Change                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| `DataSourceExecutor.ts` | Add a `Map<string, string>` cache for scoped keys, keyed by nodeId. |


**1c. Skip JSON.parse for candle_data when already an object** — The RollingWindow executor already has type checks, but the branching and try/catch per bar adds up. Pre-check and fast-path when input is already a single object (the common backtest case).

### Phase 2: Reduce indicator overhead (est. -15-20%)

**2a. Make `stateManager.getState()` synchronous** — During backtest, state is always in the L1 (in-memory) cache. Remove the `async/await` from the hot path by adding a synchronous `getStateSync()` method that reads directly from the Map without promise wrapping.


| File                       | Change                                                       |
| -------------------------- | ------------------------------------------------------------ |
| `indicatorStateManager.ts` | Add `getStateSync(key)` that returns from L1 cache directly. |
| `IndicatorsExecutor.ts`    | Use sync path when `context.silent` (backtest mode).         |


**2b. Cache `buildIndicatorKey` per node** — Same as 1b. The key is deterministic per node within a run.

### Phase 3: Reduce engine per-node overhead (est. -10-15%)

**3b. Lightweight result wrapping in silent mode** — `normalizeOutput` and `toNodeResult` create wrapper objects with metadata (nodeId, nodeName, timing). In backtest/silent mode, skip the metadata and return a minimal `{ success: true, data }` shape.


| File                 | Change                                                                     |
| -------------------- | -------------------------------------------------------------------------- |
| `normalizeOutput.ts` | Add a fast path that skips metadata enrichment when no options are passed. |
| Executor files       | In silent/backtest mode, use the lean path.                                |




This is a larger refactor and can be deferred, but would save ~18s on this specific workflow.

## Summary


| Phase                         | Target           | Est. savings    |
| ----------------------------- | ---------------- | --------------- |
| 1: RollingWindow fixes        | 133s → ~70s      | ~60s            |
| 2: Indicator sync path        | 90s → ~60s       | ~30s            |
| 3: Engine overhead            | 150s → ~110s     | ~40s            |
| 4: Template pre-compilation ✅ | ~42s → ~5s       | ~30-40s         |
| **Total**                     | **460s → ~290s** | **~170s (37%)** |

### Phase 4: Template Pre-Compilation — IMPLEMENTED

**Files changed:**
- `coreza-backend/src/utils/templateCompiler.ts` (NEW) — `compileTemplate()`, `compileNodeParams()`, `preCompileAllNodes()`
- `coreza-backend/src/services/workflowEngine.ts` — Added `_compiledParams` map, `preCompileAllNodes()` call in constructor, fast path in `resolveNodeParameters()`
- `coreza-backend/src/utils/resolveReferences.ts` — Hoisted `templateRegex` to module scope


The single highest-impact fix is **1a** (stop copying the rolling window array every bar) — likely saves 20-30s on its own.

### Phase 5: Engine Hot-Path Optimization — IMPLEMENTED

**Phase A: Eliminate per-bar reset overhead**
- `NodeStoreV2`: Added `clearResults()` and `pinResults()` — reuses store objects, only clears per-bar results while preserving pinned BacktestInit results
- `WorkflowEngine`: Added `resetForNextBar()` — ultra-lightweight reset that clears edgePayload, enqueuedKeys, executionOrder, queue, and satisfied counters in-place (no `new` allocations)
- `BacktestSession`: Replaced `resetLight()` + `preloadResults()` per bar with single `resetForNextBar()` call. `pinResults()` called once in constructor.

**Phase C: Reduce per-node overhead in executeOnce()**
- Pre-computed `_requiredEdgeCounts` per node at construction time
- `areDependenciesSatisfied()` uses O(1) counter check instead of iterating all incoming edges
- `markEdgePayloadWithCounter()` increments satisfied count on edge marking
- `keyFor()` returns just `nodeId` in backtest mode (no string concatenation)
- `enqueue()`/`dequeue()` skip `enqueuedKeys` tracking in backtest mode (deterministic DAG)
- Skip `clearIncomingEdgePayloads()` in backtest mode (bulk-cleared by `resetForNextBar()`)
- Skip loop aggregation tracking in backtest mode
- Suppressed constructor log in silent mode

**Phase D: Allocation reduction** — Assessed, `leanSuccess` already minimal. Main allocation wins from Phase A.

### Phase 6: Remaining Phase C + Phase D Completion — IMPLEMENTED

**Phase C completion: Inline selectEdges + routing**
- `WorkflowEngine.executeOnce()` — In backtest mode (`silent=true`), edge selection and routing are now inlined into a single pass over `getOutgoingEdges()`. No intermediate array allocation. Conditional (If/Switch) logic is inlined with early filtering. Eliminates ~1.9M array allocations per backtest run.
- `WorkflowEngine.executeFromEntries()` — Removed redundant `markEdgePayloadWithCounter` calls for entry nodes in backtest mode (they're enqueued directly, counter is never checked).

**Phase D: Executor allocation reduction**
- `BacktestExecutor._onBarResult` — Pre-allocated reusable result template. `executeOnBar()` mutates fields in-place instead of creating new objects per bar. Eliminates 136K object allocations.
- `DataSourceExecutor._rollingWindowResult` — Pre-allocated reusable result template. RollingWindow executor mutates fields in-place. Eliminates 136K × 2 = 272K object allocations.

**Files changed:**
- `coreza-backend/src/services/workflowEngine.ts` — Inlined selectEdges for backtest, removed entry node counter marking
- `coreza-backend/src/nodes/executors/BacktestExecutor.ts` — Pre-allocated `_onBarResult` template
- `coreza-backend/src/nodes/executors/DataSourceExecutor.ts` — Pre-allocated `_rollingWindowResult` template
**Files changed:**
- `coreza-backend/src/services/nodeStoreV2.ts` — `clearResults()`, `pinResults()`, `pinnedResults` Map
- `coreza-backend/src/services/workflowEngine.ts` — `resetForNextBar()`, `pinResults()`, `_requiredEdgeCounts`, `_satisfiedCounts`, counter-based dependency checks, backtest fast paths
- `coreza-backend/src/services/BacktestSession.ts` — Uses `resetForNextBar()` + `pinResults()` in constructor
