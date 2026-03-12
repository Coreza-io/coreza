

# Verified: `scopedKeyCache` and `indicatorKeyCache` Staleness Bug

## Finding

**This is a confirmed bug**, but with limited blast radius in practice.

### Root Cause

- Executors (`DataSourceExecutor`, `IndicatorsExecutor`) are **global singletons** — created once at process startup in `initializeNodeExecutors()` and stored in a static registry.
- The caches (`scopedKeyCache`, `indicatorKeyCache`) are `Map<nodeId, key>` on these singletons.
- Both `buildExecutionScopedKey` and `buildIndicatorKey` embed `runId` in the key string (e.g., `user:X:workflow:Y:runId:Z:node:N:...`).
- Across separate backtest runs, `runId` changes but `node.id` stays the same, so the cache returns a key containing the **old `runId`**.

### Impact Assessment

| Scenario | Risk |
|---|---|
| **BacktestSession** | Creates a new `WorkflowEngine` per run, but reuses the singleton executors. `runId` is constant within a session but different across sessions. **Stale keys would point to wrong state in L1/Redis.** |
| **LiveStrategyRunner** | Uses a stable `runId` per strategy lifetime. Safe within a single strategy, but stale across restarts if executor persists. |
| **Warm Engine Pool** | Reuses engines with `reset()` which assigns a new `runId`. Same executor singletons would serve stale cached keys. |

In practice, the bug is mitigated because:
1. **L1 cache is per-`IndicatorStateManager` instance** — a new one is created per backtest, so even a stale key would miss in L1 and fall through to warmup. The warmup would populate L1 under the stale key, but the indicator math would still be correct (same data, same params).
2. **RollingWindow state lives in `DataContext`** which is recreated per run (via `reset()`) or preserved within a run (via `resetLight()`). A stale scoped key would miss in `DataContext`, creating a fresh `RollingWindow` — correct behavior, but bypassing the cache benefit.

So the caches simply **don't help across runs** rather than causing incorrect results. But this is still worth fixing for correctness and to actually get the caching benefit in scenarios where the same executor handles consecutive runs.

## Recommended Fix

Clear both caches when a new run starts. Two options:

**Option A (simple):** Add a `clearCaches()` method to each executor, called from `WorkflowEngine.reset()` / `resetLight()`. This requires the engine to hold references to executors, which it doesn't currently.

**Option B (self-clearing, no engine changes):** Track the current `runId` in each executor. At the start of `execute()`, if `context.runId` differs from the stored `runId`, clear the cache and update the stored `runId`. This is self-contained — no changes to WorkflowEngine or registry needed.

```text
// In each executor:
private cachedRunId: string | null = null;

execute(node, input, context) {
  const runId = context?.runId;
  if (runId && runId !== this.cachedRunId) {
    this.scopedKeyCache.clear();   // or indicatorKeyCache
    this.cachedRunId = runId;
  }
  // ... rest of execute
}
```

This adds one string comparison per `execute()` call — negligible cost.

### Files to Change

| File | Change |
|---|---|
| `DataSourceExecutor.ts` | Add `cachedRunId` field, clear `scopedKeyCache` on runId change |
| `IndicatorsExecutor.ts` | Add `cachedRunId` field, clear `indicatorKeyCache` on runId change |

