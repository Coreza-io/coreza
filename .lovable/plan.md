

# Updated Plan: Live Strategies — Reuse Backtest Components

## Approach

Instead of creating separate pages/components for Live, reuse the existing `Backtests.tsx`, `BacktestResults.tsx`, and all backtest components (`EquityCurveChart`, `TradesTable`, `PerformanceMetricsCard`). The only difference is the data source — live strategies pull from `workflows`, `live_fills`, `cash_snapshots`, and `position_snapshots` instead of `backtests` tables.

The key insight: create hooks that return data in the **same shape** as `useBacktests` and `useBacktestResults`, then pass a `mode` prop (or use route context) to switch data sources.

## Architecture

```text
Existing (keep as-is):
  src/pages/Backtests.tsx           → rename to StrategiesList (or add mode prop)
  src/pages/BacktestResults.tsx     → add mode prop
  src/components/backtest/*         → reused directly (no changes)

New:
  src/hooks/useLiveStrategies.ts    → returns same shape as useBacktests
  src/hooks/useLiveStrategyDetail.ts → returns same shape as useBacktestResults
```

## Changes

### 1. New Hook: `src/hooks/useLiveStrategies.ts`

Returns the same `Backtest[]` interface shape from `useBacktests`:
- Query `workflows` where `is_active = true` and nodes contain a Portfolio node with `mode: "broker"`
- Map to: `{ id, name, workflow_id, workflow_name, status, total_return, sharpe_ratio, total_trades, created_at }`
- Status mapping: `is_active=true` → "running", otherwise "completed"
- For metrics: fetch latest `workflow_runs` result to extract portfolio data
- Subscribe to realtime changes on `workflows`
- Returns: `{ backtests, loading, stats, refetch }` — same return shape

### 2. New Hook: `src/hooks/useLiveStrategyDetail.ts`

Returns the same shape as `useBacktestResults`:
- `backtest` → workflow metadata mapped to `BacktestWithRelations` shape
- `metrics` → computed from latest `workflow_runs` result's portfolio data, mapped to `BacktestResultMetrics`
- `trades` → `live_fills` mapped to `BacktestTrade[]` shape (symbol, action=side, quantity=qty, exitPrice=price, exitTime=event_time, etc.)
- `snapshots` → `cash_snapshots` mapped to `PortfolioSnapshot[]` shape (date=snapshot_at, total_value=total_value_usdt, cash_balance from balances)
- Subscribe to realtime on `live_fills` and `cash_snapshots` for live updates
- Returns: `{ backtest, metrics, trades, snapshots, loading, error, refetch }` — identical return shape

### 3. Update `src/pages/Backtests.tsx`

Add a `mode` prop: `"backtest" | "live"` (default `"backtest"`):
- When `mode="live"`, use `useLiveStrategies()` instead of `useBacktests()`
- Change page title to "Live Strategies"
- Hide "New Backtest" button in live mode
- Row click navigates to `/dashboard/live/:id` instead of `/dashboard/backtests/:id`
- Everything else (table columns, filtering, stats cards) stays identical

### 4. Update `src/pages/BacktestResults.tsx`

Add a `mode` prop: `"backtest" | "live"` (default `"backtest"`):
- When `mode="live"`, use `useLiveStrategyDetail(id)` instead of `useBacktestResults(id)`
- Back button links to `/dashboard/live` instead of `/dashboard/backtests`
- All existing components (`EquityCurveChart`, `PerformanceMetricsCard`, `TradesTable`) receive the same data shapes — no changes needed

### 5. Add Routes: `src/pages/Interface.tsx`

```typescript
<Route path="live" element={<Backtests mode="live" />} />
<Route path="live/:id" element={<BacktestResults mode="live" />} />
```

### 6. Add Sidebar Nav: `src/components/layout/AppSidebar.tsx`

Add "Live" menu item with `Activity` icon, pointing to `/dashboard/live`.

## No Changes Needed

- `EquityCurveChart.tsx` — accepts `PortfolioSnapshot[]`, reused as-is
- `TradesTable.tsx` — accepts `BacktestTrade[]`, reused as-is
- `PerformanceMetricsCard.tsx` — accepts `BacktestResultMetrics`, reused as-is

## Files Changed

| File | Change |
|---|---|
| `src/hooks/useLiveStrategies.ts` | New — returns `useBacktests`-compatible shape from live workflow data |
| `src/hooks/useLiveStrategyDetail.ts` | New — returns `useBacktestResults`-compatible shape from live fills/snapshots |
| `src/pages/Backtests.tsx` | Add `mode` prop to switch between backtest/live data source |
| `src/pages/BacktestResults.tsx` | Add `mode` prop to switch between backtest/live data source |
| `src/pages/Interface.tsx` | Add `/live` and `/live/:id` routes |
| `src/components/layout/AppSidebar.tsx` | Add "Live" nav item |

