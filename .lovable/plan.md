
# Fix Live Strategy Metrics

## Root Cause Analysis

The `cash_snapshots.equity` field stores **cumulative realized PnL** (starts at 0, goes up/down with trades), NOT absolute portfolio value. The first snapshot always has `equity: 0`. This breaks three things:

### Issue 1: Total Return = -100%
- `cleanSnapshots` filter (`equity >= 0`) keeps the first snapshot (equity=0) but removes negative-PnL snapshots
- `initialCapital` falls back to `cleanSnapshots[0].equity = 0`
- `computedTotalReturn` guard (`initialCapital > 0`) fails, returns `undefined`
- But `calculateRiskMetrics` also computes `totalReturnPct` with `firstEquity = 0` → `undefined`
- The -100% likely comes from a scenario where `firstEquity` is a tiny positive value (e.g. 0.10) and `lastEquity` is near-zero, yielding ~-100%

### Issue 2: Sharpe/Sortino/Calmar all "—"
- All snapshots are within a single day (~10-45 minutes)
- `resampleToDailyCloseReturns` groups by day bucket → only 1 bucket → 0 returns
- `enoughForRatios = returns.length >= 30` → false → all ratios undefined

### Issue 3: Max Drawdown "—"
- The `equity >= 0` filter removes negative-PnL snapshots, so drawdown calculation sees incomplete data
- With only positive-equity snapshots remaining, drawdown may appear as 0 or be computed incorrectly

## Planned Changes (3 files, minimal edits)

### 1. `src/lib/liveMetrics.ts` — Fix equity interpretation and intraday resampling

**a) Remove the `equity >= 0` filter (line 161)**
Negative equity values are valid (negative PnL). The filter was incorrectly discarding them. Change to only filter for valid timestamps.

**b) Fix `initialCapital` for PnL-based equity (line 166-169)**
When equity represents PnL (first snapshot equity ~0), derive `initialCapital` from the first trade's entry price. Accept a new optional `initialCapital` from the caller. If not provided and first equity is 0 or near-zero, use the cumulative net PnL to compute return as `(netPnL / entryCapital)` where entryCapital comes from a new parameter.

Pragmatic approach: add an `entryCapital` field to `buildLiveMetrics` params derived from the first trade's entry price. In the caller, compute this from `closedTrades[0].entryPrice * quantity`.

**c) Add intraday resampling fallback (lines 40-63)**
When all data fits in a single day bucket, fall back to per-snapshot returns instead of daily returns. Lower the `enoughForRatios` threshold to 5 for intraday data (with an annualization factor based on actual interval, not 252 trading days).

**d) Guard Calmar NaN (line 105)**
When `annualizedReturn` is `undefined`, return `undefined` for `calmar_ratio` instead of `undefined / 100 / maxDrawdownPct` which yields `NaN`.

### 2. `src/hooks/useLiveStrategyDetail.ts` — Pass entry capital to buildLiveMetrics

Compute `entryCapital` from the first closed trade's entry price and quantity. Pass it to `buildLiveMetrics` so Total Return can be computed as `netPnL / entryCapital * 100`.

### 3. `src/components/backtest/PerformanceMetricsCard.tsx` — Guard NaN/Infinity display

In the `MetricItem` component, add a check: if `value` is `NaN` or `Infinity`, display "—" instead of the malformed number.

## Technical Details

**Intraday resampling logic:**
- Detect single-day data: all points share the same day bucket
- Use per-snapshot returns instead of daily close returns  
- Annualize using: `sqrt(periodsPerYear)` where `periodsPerYear = totalTimeSpanMs / avgIntervalMs * 252/365`
- Lower threshold: require at least 5 return observations for ratio computation

**Entry capital derivation:**
- From `closedTrades[0]`: `entryPrice * quantity` gives the notional capital deployed
- This is the correct denominator for return calculation in a PnL-based equity curve
