

# Review: Phases A, C, D Implementation

## Verdict: Phase A is well-implemented. Phase C is partially implemented. Phase D was not implemented.

---

## Phase A: Eliminate per-bar reset overhead — WELL DONE

All three components are correctly implemented:

| Component | Status | Details |
|---|---|---|
| `NodeStoreV2.clearResults()` | Correct | Clears `nodeResults`, restores pinned entries, rebuilds `_cachedResults` from pinned only |
| `NodeStoreV2.pinResults()` | Correct | Stores immutable entries in separate `pinnedResults` Map, also populates `nodeResults` and cache |
| `WorkflowEngine.resetForNextBar()` | Correct | In-place clears of `edgePayload`, `enqueuedKeys`, `executionOrder`, queue, satisfied counts — no `new` allocations |
| `BacktestSession` | Correct | Calls `pinResults()` once in constructor, uses `resetForNextBar()` per bar instead of `resetLight()` |

One minor inefficiency in `clearResults()` (lines 204-220): it iterates `pinnedResults` **twice** — once to restore into `nodeResults`, once to rebuild `_cachedResults`. Could be a single loop, but with typically 1-3 pinned results this is negligible.

---

## Phase C: Reduce per-node overhead — PARTIALLY IMPLEMENTED

### What was done (correct):
- **`keyFor` fast path** (line 481): Returns `item.nodeId` directly when `silent=true` — skips string concatenation. Good.
- **`enqueue` skip dedup** (lines 489-493): Skips `enqueuedKeys` tracking in backtest mode. Good.
- **`dequeue` skip dedup** (line 502): Skips `enqueuedKeys.delete()` in backtest mode. Good.
- **Pre-computed `_requiredEdgeCounts`** (lines 168-173): Built once in constructor. Correct.
- **`_satisfiedCounts` counter** (lines 104, 677-680): `markEdgePayloadWithCounter` increments counter per target node. `areDependenciesSatisfied` compares counter vs required. Good O(1) check.
- **Skip `clearIncomingEdgePayloads`** (lines 1013-1016): Skipped when `silent=true`, bulk-cleared by `resetForNextBar`. Good.
- **Skip loop aggregation tracking** (lines 993-1007): Guarded by `!this.silent`. Good.

### What was NOT done:

1. **"Combine `selectEdges()` + routing into a single pass"** — `selectEdges()` still returns an intermediate array (line 983), then a separate `for` loop routes each edge (lines 1009-1011). This allocates a new array per node per bar. For 14 hot-path nodes × 136K bars = ~1.9M array allocations. Fix: inline `selectEdges` logic into the routing loop when `silent=true`, or at minimum call `getOutgoingEdges` directly and filter in-place.

2. **`performance.now()` overhead** — Still called twice per node (lines 936, 938). On V8, `performance.now()` is ~50ns per call, so 1.9M × 2 × 50ns ≈ 0.19s — minimal but present.

---

## Phase D: Reduce object allocations — NOT IMPLEMENTED

The plan called for:
1. Pre-allocate reusable result templates for hot-path executors (`OnBar`, `RollingWindow`)
2. Reuse `leanSuccess()` result objects in backtest mode (mutate `.data`)
3. Avoid wrapping `RollingWindow` output

None of these were implemented. The executor code was not modified.

---

## Bug: `_satisfiedCounts` not cleared for re-enqueued nodes

When `resetForNextBar()` is called, `_satisfiedCounts` is cleared (line 248). But within a single bar, if a node is routed to by multiple edges across different execution stages, the counter correctly accumulates. This is fine.

However, there's a subtle issue: `executeFromEntries` (line 292-301) pre-marks incoming edges for entry nodes using `markEdgePayloadWithCounter`. This correctly increments the counter. But if an entry node has only 1 incoming edge, `_requiredEdgeCounts` would be 1, and the counter becomes 1, so `areDependenciesSatisfied` returns true. This works.

BUT: the entry nodes are enqueued directly (line 301) **without** checking `areDependenciesSatisfied`. The counter marking is only needed for downstream nodes. The entry node marking + enqueue is redundant work — the counter is set but never checked for entry nodes. This is harmless but wasteful.

---

## Summary of remaining work

| Item | Impact | Effort |
|---|---|---|
| Inline `selectEdges` + routing for backtest mode | ~5-8s (eliminates 1.9M array allocations) | ~20 lines |
| Phase D: Executor allocation reduction | ~10-15s | Requires reading executor code |
| Remove redundant entry node counter marking | Negligible | 3 lines |

The implementation so far should yield **~15-20s savings** from Phase A + partial Phase C, bringing the backtest from ~224s to ~200-210s. To reach the target ~160s, Phase D (executor allocations) and the `selectEdges` inlining are needed.

