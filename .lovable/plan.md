

# Revised Backtest Performance Plan (Phase B Removed)

## Phases

### Phase A: Eliminate per-bar reset overhead (~25-30s savings)
- **NodeStoreV2**: Add `clearResults()` (only clears results, preserves node defs) and `pinResults()` (immutable entries that survive clears)
- **WorkflowEngine**: Add `resetForNextBar()` that reuses existing objects instead of creating new ones
- **BacktestSession**: Replace `resetLight()` + `preloadResults()` with `resetForNextBar()`, call `preloadResults()` once in constructor

### ~~Phase B: Queue dequeue fix~~ — REMOVED
Queue holds 1-6 items max. `Array.shift()` on small arrays is O(1) in V8. No measurable impact.

### Phase C: Reduce per-node overhead in `executeOnce()` (~15-20s savings)
- Cache `keyFor()` results — in backtest mode the key is just `nodeId`, skip string concat
- Skip `enqueuedKeys` tracking in backtest mode (deterministic DAG, no duplicates)
- Combine `selectEdges()` + routing into single pass
- Cache dependency counts at build time — use satisfied counter instead of iterating incoming edges

### Phase D: Reduce object allocations in executors (~10-15s savings)
- Pre-allocate reusable result templates for hot-path executors (`OnBar`, `RollingWindow`)
- Reuse `leanSuccess()` result objects in backtest mode (mutate `.data`)
- Avoid wrapping `RollingWindow` output when downstream only reads specific fields

## Expected Impact

| Phase | Estimated savings |
|---|---|
| A: Reset/preload elimination | ~25-30s |
| C: Per-node overhead | ~15-20s |
| D: Allocation reduction | ~10-15s |
| **Total** | **~50-65s** (224s → ~160s) |

