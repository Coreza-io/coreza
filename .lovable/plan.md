# Align Performance Chart with Live Strategy Detail

Two small changes so the dashboard's Performance Chart agrees with each live workflow's Net Profit metric.

## Why

`useLiveStrategyDetail` (the Live Strategy Detail page) scopes its trades to the workflow's **current `active_execution_id`** (a "session"). When a workflow is stopped and restarted, a new `execution_id` is issued; trades from previous sessions are excluded from Net Profit. The Performance Chart on the dashboard does not apply this filter today — it pulls every `live_trades` row for currently-active workflows, including rows from earlier sessions. That's why the chart shows ~$7.74 of losses for `Testing_Binance_Spot_Stream` while the detail page shows -$0.24 for the same workflow.

A secondary issue: the chart buckets trades by **local-timezone day**, but every other live metric in the app (cash snapshots, equity series, live metrics) uses UTC. That causes May 18/19 trades to shift across day boundaries.

## What changes

`src/pages/Dashboard.tsx` — only the Performance Chart fetch:

1. When fetching live workflow IDs, also select `active_execution_id`. Build a `Map<workflowId, executionId>` for only those workflows that have a non-null `active_execution_id`. Workflows that are `is_active` but have no `active_execution_id` get excluded from the chart (no session running → no session-scoped P/L).
2. Replace the current "where workflow_id IN (...)" `live_trades` query with: `.in("workflow_id", ids).in("execution_id", sessionIds)` so we only pull trades from the **current** sessions. (RLS still restricts to the user.)
3. As an extra safety filter on the client, drop any returned trade whose `execution_id` doesn't match `activeMap.get(trade.workflow_id)` (handles the edge case where two workflows share an execution id by coincidence in the IN list).
4. Change day bucketing from local timezone to UTC: bucket key becomes `new Date(t.exitTime).toISOString().slice(0, 10)` (YYYY-MM-DD UTC). Keep the same display label format (`May 19`) but compute it from a UTC date so the tooltip/axis label matches the bucket.
5. Empty-state message stays the same; if there are zero active sessions, show "No live P/L yet".

No other files change. No schema/RLS changes. No edit to `useLiveStrategyDetail` — its behavior is the desired source of truth.

## Verification

After the change, for the user's current data:
- `Testing_Binance_Spot_Stream` is the only currently-live session → chart sums only that workflow's current-session trades.
- The sum of the chart's daily values for that workflow equals the Net Profit shown on the Live Strategy Detail page (-$0.24).
- Stopping & restarting the workflow resets the chart to that new session's trades (matching how the detail page resets).
- Day labels match UTC boundaries — May 18 and May 19 trades plot on their UTC dates, no off-by-one with cash_snapshots/equity timestamps.
- Dashboard "Performance" tile (30-day total) recomputes from the new series and equals the sum of plotted points.
