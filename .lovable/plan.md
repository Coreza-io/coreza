## What I found

The previous fix partially handled Total Return, but Annualized Return and Sharpe Ratio still have two logic gaps:

1. **Annualized Return still uses an inconsistent baseline**
   - `calculateRiskMetrics()` receives normalized equity points, but it uses `baselineCapital` as the first equity.
   - For PnL-style snapshots, the normalized first equity is `initialCapital + firstPnl`.
   - If the first snapshot PnL is not exactly zero, Annualized Return can still be anchored incorrectly and drift toward the old `-100%` style behavior.
   - The formula also annualizes a few minutes of live data with a very large exponent, which can produce misleading extreme values.

2. **Sharpe Ratio is not populating because the sample threshold is still too high for the active live session**
   - Current active session has only ~9 snapshots / ~8 returns.
   - The code’s hourly path can require `10` returns, and the daily path requires `30`.
   - Result: `enoughForRatios` is false, so Sharpe/Sortino are intentionally returned as `undefined` and the card shows `—`.

3. **Realtime snapshot updates only append chart snapshots, not recompute metrics**
   - On new `cash_snapshots` inserts, `useLiveStrategyDetail.ts` updates `snapshots`, but does not call `buildLiveMetrics()` again.
   - Metrics therefore can remain stale until a full reload or trade insert reload happens.

## Implementation plan

### 1. Fix live risk metric baseline in `src/lib/liveMetrics.ts`

- Change `calculateRiskMetrics()` so Total/Annualized Return uses the actual first normalized equity point as the baseline for curve math.
- Keep `baselineCapital` only as the starting peak/drawdown floor where useful.
- This prevents Annualized Return from mixing `initialCapital` with a normalized curve whose first point may already include live PnL.

### 2. Make Annualized Return safe for intraday live sessions

- For daily data, keep the existing CAGR-style annualization.
- For intraday/per-snapshot data, calculate annualized return from the mean period return:
  - `annualizedReturn = ((1 + avgReturn) ^ periodsPerYear - 1) * 100`
- Clamp or reject impossible non-finite outputs so the UI shows `—` instead of extreme invalid values.
- This removes the remaining `-99.98%` / initial `-100%` annualized-return artifact.

### 3. Lower the live intraday Sharpe threshold

- In the per-snapshot fallback, reduce `minSamplesForRatios` from `5` to `3` so short live sessions can populate once there is enough meaningful data.
- Avoid the hourly bucket path blocking Sharpe at `10` samples; for live sessions with only one day of data, prefer the per-snapshot return series when it has enough data.
- Keep a minimum sample guard so Sharpe is not calculated from only 1 return.

### 4. Recompute metrics when live snapshots arrive

- In `useLiveStrategyDetail.ts`, store the latest closed trade metric input and portfolio summary in refs.
- When a realtime `cash_snapshots` insert arrives, append the new chart snapshot and also recompute `metrics` using the updated snapshot list.
- This makes Annualized Return, Sharpe Ratio, drawdown, and final portfolio value populate/update without requiring a page refresh.

### 5. Normalize live chart snapshots consistently

- For PnL-style cash snapshots, the chart currently receives raw PnL values as `total_value`, while metrics use normalized portfolio equity.
- Add a small helper so live `PortfolioSnapshot.total_value` is translated to `initialCapital + equity` when the stream is PnL-based.
- This aligns the Equity Curve with the metric calculations.

### 6. Verify against the active session data

After the code changes, I will validate the active workflow session using the database data:

- Annualized Return should no longer show `-99.98%` / `-100%` for PnL-based live snapshots.
- Sharpe Ratio should populate once there are at least 3 per-snapshot returns and non-zero volatility.
- Total Return should remain correct.
- Alpaca/absolute-equity sessions should not be regressed.