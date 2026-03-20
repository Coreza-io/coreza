

# Analysis: Why Overhead is ~2s in Both Modes (10.8% Compiled vs 4.6% Engine)

## The Key Insight: Same Absolute Cost, Different Denominator

| Metric | ENGINE | COMPILED |
|---|---|---|
| Overhead (absolute) | 2,267 ms | 2,090 ms |
| Total runtime | 49,345 ms | 19,391 ms |
| Overhead (%) | 4.6% | **10.8%** |

The absolute overhead is nearly identical (~2.1s). The percentage is 2.3x higher in compiled mode simply because the total runtime is 2.5x smaller — the same fixed costs become a larger fraction.

## What's Inside the ~2s Overhead

### 1. `reportProgress()` Redis writes — ~1,800-1,900 ms (dominant)

Every 500 bars, `runAll()` calls `await this.reportProgress()` which does:
```
redis.set(`backtest:progress:${id}`, JSON.stringify({...}), "EX", 3600)
```

189,033 bars ÷ 500 = **378 Redis round-trips**. At ~5ms per Redis call, that's **~1,890 ms** — nearly the entire overhead budget.

This is identical in both modes (same chunk size, same bar count).

### 2. `setImmediate()` yields — ~50-100 ms

Each chunk boundary does `await new Promise(resolve => setImmediate(resolve))`. 378 yields × ~0.1-0.3ms each ≈ 50-100ms.

### 3. `{ data: symbolEvent }` object allocation — ~30-50 ms

In the compiled path (line 318): `runBar(this.compiledPlan, { data: symbolEvent })` creates a new wrapper object per symbol execution. 378,063 allocations.

### 4. Outer loop control — ~10-20 ms

`while` checks, `signal.aborted` checks, index increments, try/catch per bar.

### 5. Bug: `buildResultMs` not included in `tracked` sum

Line 642-647 computes `tracked` as:
```
simBrokerOnBarMs + resetMs + executeLoopMs + contextBuildMs + equitySnapshotMs
```

`buildResultMs` (135.8ms in ENGINE) and `storeClearMs` (867.3ms, but subset of `resetMs`) are displayed but `buildResultMs` is **not subtracted from overhead**. So ENGINE's "true" unaccounted overhead is actually 2,267 - 136 = **2,131 ms** — even closer to compiled's 2,090 ms.

## Summary

| Overhead Source | Est. ms | Both Modes? |
|---|---|---|
| Redis `reportProgress()` × 378 | ~1,890 | Yes — identical |
| `setImmediate` yields × 378 | ~75 | Yes — identical |
| Object allocation (`{ data: ... }`) | ~40 | Yes — identical |
| Loop control / try-catch | ~15 | Yes — identical |
| GC pauses from above allocations | ~70 | Yes — similar |
| **Total** | **~2,090** | |

## Proposed Fix: Reduce Overhead from ~2s to ~200ms

### Fix 1: Reduce `reportProgress()` frequency
Change chunk size from 500 to 5,000 bars. This cuts Redis calls from 378 to 38. Saves ~1,700ms.

### Fix 2: Fix `tracked` sum to include `buildResultMs`
Add `p.buildResultMs` to the `tracked` calculation so overhead reporting is accurate.

### Fix 3: Reuse the `{ data: symbolEvent }` wrapper
Pre-allocate one object, mutate its `data` field each iteration instead of creating 378K objects.

### Fix 4: Batch or skip `reportProgress()` based on elapsed time
Instead of every N bars, report every ~2 seconds of wall-clock time. This adapts to execution speed.

### Expected Result
Overhead drops from ~2,090ms to ~200ms. For compiled mode, that's from 10.8% to ~1%. Total compiled runtime drops from 19.4s to ~17.5s, pushing bars/sec from 9,748 to ~10,800.

