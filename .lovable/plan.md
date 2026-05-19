# Performance Chart — total daily P/L across live workflows

Replace the mock random data in the Dashboard's Performance Chart with a real series: **total realized P/L per day across all currently-live workflows**, over the last 30 days.

## What changes

`src/pages/Dashboard.tsx`

1. Remove the mock generator at lines ~110–114 (`Array.from({ length: 30 } ...)` with `Math.random`).
2. Add a parallel fetch alongside the existing workflows query:
   - Identify the user's live workflow IDs: workflows where `is_active = true` AND the nodes JSON contains a Portfolio node in broker mode (reuse the `isBrokerPortfolioWorkflow` check from `src/hooks/useLiveStrategies.ts` — extract it to a small shared helper, e.g. `src/utils/liveWorkflowFilter.ts`, so Dashboard and `useLiveStrategies` share one source of truth).
   - Query `live_trades` for those workflow IDs with `exitTime >= now - 30 days`, selecting `exitTime` and `net_pnl`. RLS already restricts to the user.
3. Build a 30-day series in the browser:
   - Start with a map of the last 30 calendar days (local timezone) → `pnl: 0`.
   - For each trade, bucket by `exitTime` day and add `net_pnl`.
   - Output array shape stays `{ date: 'May 19', value: number }` so the existing `<LineChart>` keeps working without prop changes.
4. Update the chart card header to reflect the new metric: title stays "Performance Chart", description becomes "Total daily P/L across live workflows (last 30 days)".
5. Empty state: if there are no live workflows or no trades, render a small centered "No live P/L yet" message inside the chart card instead of a flat-zero line.
6. Color: keep the existing orange stroke; add a subtle horizontal zero baseline (`<ReferenceLine y={0}>`) so wins vs losses are obvious. Y-axis formatter shows currency-ish values (e.g. `$1.2k`, `-$340`).

## Performance card stat (top-right tile)

The "Performance — N/A / Coming soon" tile becomes live too: show the **sum of `value` across the 30-day series** as the headline (e.g. `+$1,240.50`), with subtext "Last 30 days · N live workflows". Trend arrow up/down based on sign. This reuses the same fetched data — no extra query.

## Out of scope

- No new tables, columns, RLS, or edge functions — `live_trades` already exposes `net_pnl` and is RLS-scoped to the user.
- No realtime subscription on the chart (the dashboard already reloads on mount); can be added later if needed.
- No per-workflow breakdown lines — single aggregate line per user's choice.

## Verification

- Open `/dashboard` with at least one live (broker-mode Portfolio) workflow that has closed trades → chart shows a non-flat line summing `net_pnl` per day; Performance tile shows the 30-day total.
- Disable all live workflows → chart card shows the empty state; Performance tile shows `$0.00 · 0 live workflows`.
- Cross-check one day's value: sum `net_pnl` in `live_trades` for that day across live workflow IDs equals the plotted point.
- Light/dark theme both render legibly; no console or network errors.
