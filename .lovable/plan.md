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