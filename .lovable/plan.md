

# Performance Fix Plan: Make TypedArrays Actually Work + Eliminate Real Bottleneck

## Why You See Zero Improvement (Root Cause)

Three bugs in the current implementation completely nullify the TypedArray optimization:

### Bug 1: BarBuffer is Dead Code
`BarBuffer` class exists but is never instantiated or used for bar iteration. `onBar()` still receives a `Bar` object (heap-allocated). The only usage is two static utility methods (`toEpochMs`, `dayBucket`) which are just number converters -- not TypedArray storage.

### Bug 2: Double-Writing Equity Curve
`recordEquityPoint()` writes to BOTH the new TypedArray AND the old `state.equityCurve` object array. Net effect: **more** work than before.

### Bug 3: Consumers Read Old Array
`getMetrics()`, `resampleToDaily()`, `getEquityCurve()` all read from `this.state.equityCurve` (the old object array). The TypedArray data is written but never read by anything.

### The Real Bottleneck at 27K Bars
At 27K bars, GC pressure is negligible. The dominant cost is likely:
- **Per-bar workflow engine overhead** (if using the node-by-node executor path, not the fast path)
- **`console.log` on every order fill** (line 340-342) -- synchronous I/O in the hot loop
- **`resampleToDaily()` sorts the entire equity curve** (line 727) at metrics time -- `[...curve].sort()` copies + sorts 27K objects

---

## Fix Plan (3 tiers, ordered by impact)

### Tier A: Remove Double-Write + Wire TypedArrays as Primary Store

**File: `coreza-backend/src/services/simBroker/index.ts`**

1. **Remove `state.equityCurve` entirely** -- delete the object array from `PortfolioState` initialization (line 98) and stop pushing to it (line 201-207 in `recordEquityPoint`).

2. **Replace `getEquityCurve()`** (line 817) -- reconstruct `EquityPoint[]` from TypedArrays only when needed (at the end, for DB persistence):
```typescript
getEquityCurve(): EquityPoint[] {
  const result: EquityPoint[] = new Array(this.equityCurveIndex);
  for (let i = 0; i < this.equityCurveIndex; i++) {
    result[i] = {
      timestamp: new Date(this.equityCurveData.timestamps[i]).toISOString(),
      cash: this.equityCurveData.cash[i],
      positionsValue: this.equityCurveData.positionsValue[i],
      totalEquity: this.equityCurveData.totalEquity[i],
      drawdownPct: this.equityCurveData.drawdownPct[i],
    };
  }
  return result;
}
```

3. **Rewrite `getMetrics()`** to read directly from TypedArrays instead of `state.equityCurve`:
```typescript
// Final equity from TypedArray:
const lastIdx = this.equityCurveIndex - 1;
const finalEquity = lastIdx >= 0
  ? this.equityCurveData.totalEquity[lastIdx]
  : initialCapital;

// Max drawdown from TypedArray (no .map() needed):
let maxDrawdownPct = 0;
for (let i = 0; i < this.equityCurveIndex; i++) {
  if (this.equityCurveData.drawdownPct[i] > maxDrawdownPct) {
    maxDrawdownPct = this.equityCurveData.drawdownPct[i];
  }
}
```

4. **Rewrite `resampleToDaily()`** to work on TypedArrays directly -- no sort, no object creation:
```typescript
private resampleToDailyReturns(): number[] {
  if (this.equityCurveIndex < 2) return [];

  const DAY_MS = 86_400_000;
  const returns: number[] = [];
  let prevDayBucket = Math.floor(this.equityCurveData.timestamps[0] / DAY_MS);
  let prevEquity = this.equityCurveData.totalEquity[0];

  for (let i = 1; i < this.equityCurveIndex; i++) {
    const dayBucket = Math.floor(this.equityCurveData.timestamps[i] / DAY_MS);
    if (dayBucket !== prevDayBucket) {
      const equity = this.equityCurveData.totalEquity[i];
      if (prevEquity > 0) {
        returns.push((equity - prevEquity) / prevEquity);
      }
      prevEquity = equity;
      prevDayBucket = dayBucket;
    }
  }
  return returns;
}
```
This eliminates the `[...curve].sort()` copy + sort of 27K objects AND the `Map` allocation in one shot.

5. **Remove `console.log` from fill path** (line 340-342 and line 157-159) -- replace with a counter that logs summary at end:
```typescript
// Remove from onBar fill loop:
// console.log(`[SimBroker] Order filled: ...`);

// Add to getMetrics() or a summary method:
console.log(`[SimBroker] Completed: ${this.state.trades.length} trades, ${this.equityCurveIndex} bars`);
```

### Tier B: Use BarBuffer in Fast Path (if fast path engine exists)

**File: `coreza-backend/src/services/simBroker/index.ts`**

Add an `onBarFromBuffer(symbol: string, buffer: BarBuffer, index: number)` method that reads directly from TypedArrays without creating a `Bar` object:

```typescript
onBarFromBuffer(symbol: string, buffer: BarBuffer, index: number): OrderFill[] {
  // Read directly from TypedArrays -- no Bar object created
  const open = buffer.open[index];
  const high = buffer.high[index];
  const low = buffer.low[index];
  const close = buffer.close[index];
  const volume = buffer.volume[index];
  const timestamp = buffer.timestamps[index]; // numeric

  // Process pending orders using raw values...
}
```

This requires the caller (BacktestExecutor or fast engine) to pre-load all bars into a `BarBuffer` before the loop, then iterate by index. This is only useful if there's a fast-path loop that can use it.

However, at 27K bars this won't make a measurable difference. The bar object allocation is ~0.5ms total for 27K bars.

### Tier C: Interface Cleanup

**File: `coreza-backend/src/services/simBroker/interfaces.ts`**

The `EquityPoint` and `NumericEquityPoint` interfaces can stay as-is since they're used for DB persistence and API responses. The internal hot path just won't create them during iteration anymore.

---

## Expected Impact

| Change | Impact at 27K bars | Impact at 390K bars |
|---|---|---|
| Remove double-write (Tier A.1) | ~10-20% faster | ~30-40% faster |
| TypedArray-based getMetrics (Tier A.3) | ~5% faster | ~20% faster |
| TypedArray resampleToDaily (Tier A.4) | ~15% faster (eliminates sort+copy) | ~40% faster |
| Remove console.log from fills (Tier A.5) | **~20-50% faster** (biggest at 27K) | ~10% faster |
| BarBuffer in hot path (Tier B) | Negligible | ~10-15% faster |

**The single biggest win at 27K bars is removing `console.log` from the fill loop.** Each `console.log` is a synchronous I/O call. If you have 200 trades, that's 200+ console.log calls in the hot path. At 390K bars, the memory optimizations dominate.

## Honest Assessment: Can Coreza Match QuantConnect?

**No, not at the language level.** But that's the wrong question. The right question is: **Is 27K bars in <1 second acceptable?** After these fixes, it should be. The current bottleneck is almost certainly NOT the TypedArray vs object gap -- it's console.log I/O, double-writes, and the sort-copy in resampleToDaily.

After Tier A fixes, expected performance:
- 27K bars: 0.1-0.3 seconds (from current ~0.5-2s, depending on trade count)
- 390K bars: 3-8 seconds (from current ~10-30s)

The remaining gap vs LEAN is V8 JIT overhead, heap-allocated objects for orders/trades (unavoidable in JS), and GC pauses -- none of which can be closed without switching languages.

## Files Changed

| File | Changes |
|---|---|
| `coreza-backend/src/services/simBroker/index.ts` | Remove double-write in `recordEquityPoint`, rewrite `getMetrics` to read TypedArrays, rewrite `resampleToDaily` to avoid sort+copy, remove `console.log` from fill loop, rewrite `getEquityCurve` to reconstruct from TypedArrays on demand |

Only one file needs changes. The `BarBuffer.ts` class is fine as-is -- it just needs to actually be used by callers (Tier B, optional).
