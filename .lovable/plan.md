
# Overhead Reduction: Backtest Hot Path

## Implemented Fixes

### Fix 1: Time-based progress reporting (was bar-count-based)
- Changed from reporting every 500 bars to every 2 seconds of wall-clock time
- Increased chunk size from 500 to 5,000 bars
- Cuts Redis calls from ~378 to ~10-15 for a 189K bar backtest
- Applied to both COMPILED and ENGINE paths

### Fix 2: Fixed `tracked` sum to include `buildResultMs` + `storeClearMs`
- `overheadMs` was artificially inflated because `buildResultMs` and `storeClearMs` were displayed but not subtracted from overhead
- ENGINE mode was showing ~135ms + ~867ms as "overhead" that was actually tracked work

### Fix 3: Reusable `{ data: symbolEvent }` wrapper for compiled path
- Pre-allocated `reusableBarInput` object on the session
- Mutates `.data` field each iteration instead of creating 378K wrapper objects
- Eliminates GC pressure from transient allocations

### Fix 4: Larger chunks = fewer `setImmediate()` yields
- 5,000-bar chunks instead of 500 means ~38 yields instead of 378
- Each yield costs ~0.1-0.3ms

## Expected Impact
- Overhead drops from ~2,090ms to ~200ms
- Compiled overhead % drops from 10.8% to ~1%
- Total compiled runtime: ~17.5s → ~10,800 bars/sec
