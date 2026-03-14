

# Phase 2 Review: Pre-resolved Parameter Slots

## Current Implementation Analysis

The existing `resolveNodeParameters` flow per node per bar:

```text
resolveNodeParameters(node, input)
  → Map.get(node.id)                           // ~20ns - get CompiledNodeParams
  → this.store.getAllResults()                   // ~5ns  - returns _cachedResults (already cached)
  → compiled.resolve(allNodeData)               // ~100-200ns - iterates compiledEntries, allocates new object
    → for each entry:
        entry.accessor(allNodeData)             // ~10ns - allNodeData[nodeName] + pathAccessor
    → builds { key: value, ... } object         // ~50-100ns allocation
  → return resolved
```

At 1.9M calls: the `resolve()` function alone costs ~190-380ms. The **object allocation** inside `resolve()` (a new `resolved` object per call) adds GC pressure but the total is modest.

## Why Slots Won't Help Much Here

| Operation | Current | Slot-based | Difference |
|---|---|---|---|
| Data lookup | `allNodeData['RollingWindow']` (property on plain obj) | `slots[3]` (array index) | ~0ns — V8 optimizes both to direct offset reads |
| `getAllResults()` | Returns cached `_cachedResults` | Eliminated | ~5ns × 1.9M = 9.5ms saved |
| `resolve()` iteration | Loops `compiledEntries` | Eliminated | ~50ns × 1.9M = 95ms saved |
| `resolved` object alloc | New `{}` per call | Eliminated | ~50ns × 1.9M = 95ms saved |
| **Total savings** | | | **~200ms** |

The slot approach saves ~200ms, not the ~30s claimed. The original estimate of "~200s → ~170s" was based on incorrect assumptions about `resolveNodeParameters` cost.

## What Actually Costs Time

The real per-node overhead is spread across the entire `executeOnce()` path, not concentrated in parameter resolution. From the timing data:

- 14 nodes × 136K bars = 1.9M iterations
- Sum of node times: 207s
- Wall time: 278s
- Engine overhead: **71s** (queue management, routing, edge tracking, `performance.now()`, `setNodeResult`, etc.)

Parameter resolution is maybe 5-10% of that 71s (~4-7s), not 30s.

## A More Impactful Alternative

Instead of slots, the same effort could be applied to **pre-allocating the `resolved` params object per node** (same pattern as the RollingWindow result fix):

```typescript
// In resolveNodeParameters, backtest fast path:
if (!this._resolvedParamsCache.has(node.id)) {
  this._resolvedParamsCache.set(node.id, {});
}
const resolved = this._resolvedParamsCache.get(node.id)!;
// Mutate in-place instead of allocating new object
for (const entry of compiledEntries) {
  resolved[entry.key] = entry.accessor ? entry.accessor(allNodeData) : entry.staticValue;
}
return resolved;
```

This eliminates the object allocation (saves GC pressure on 1.9M objects) with 3 lines of code change — no new architecture needed.

## Verdict

**Phase 2 as designed (slot map) is over-engineered for its impact.** The ~200ms savings don't justify the complexity of:
- Building a slot index mapping at construction
- Rewriting all executor parameter access patterns
- Maintaining slot ↔ node ID mapping

**Recommendation:** Skip Phase 2. Instead, apply the trivial per-node params cache shown above (~3 lines), then focus effort on Phase 1 (sync execution — eliminates 1.9M `await` round-trips, ~10-20s) or Phase 3 (compiled strategy — eliminates the engine entirely, ~200s+).

