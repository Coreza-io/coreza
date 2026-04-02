

# Plan: Unified vs Separate Tables for Backtest and Live Trades

## Analysis: Why Renaming/Unifying is Problematic

### Structural Differences

| Aspect | Backtest Tables | Live Tables |
|--------|----------------|-------------|
| Primary FK | `backtest_id` → `backtests` table | `workflow_id` + `run_id` + `user_id` |
| RLS | Joins through `backtests` to get `user_id` | Direct `user_id` column |
| Data lifecycle | Batch insert at backtest completion | Incremental inserts during execution |
| Existing data | Has production data in 3 tables | `live_fills` and `cash_snapshots` exist |

### What Would Unification Require

To rename `backtest_trades` → `trades` (generic):
1. **Add columns**: `workflow_id`, `run_id`, `user_id`, `broker`, `source_type` (backtest vs live), `entry_order_id`, `exit_order_id`
2. **Keep columns**: `backtest_id` (nullable for live rows)
3. **Rewrite RLS**: New policies that handle both backtest (join through `backtests`) and live (direct `user_id`) access patterns
4. **Migrate all references**: `BacktestExecutor.ts`, `useBacktestResults.ts`, `useBacktests.ts` (joined query), `useLiveStrategyDetail.ts`, `types/supabase.ts` (auto-generated, cannot edit)
5. **Same for `backtest_results`** → `results` and `backtest_portfolio_snapshots` → `portfolio_snapshots`
6. **Data migration**: Backfill `user_id` on all existing rows

**The `supabase/types.ts` file is auto-generated and cannot be manually edited** — table renames would require waiting for regeneration, and all existing Supabase joined queries (like `backtests` → `backtest_results` FK relationship used in `useBacktests.ts` line 58) would break.

### Verdict

Unifying tables adds significant migration risk and complexity for marginal benefit. The backtest and live data have fundamentally different lifecycles (batch vs incremental) and access patterns (backtest_id vs workflow_id). The frontend hooks are already separate (`useBacktestResults` vs `useLiveStrategyDetail`).

## Recommended Approach: Create `live_trades` (Mirror Pattern)

Create a new `live_trades` table that mirrors `backtest_trades` column structure but uses live-appropriate FKs. The frontend mapping code is already shared via the `BacktestTrade` interface.

### Step 1: Create `live_trades` table (migration)

```sql
CREATE TABLE public.live_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workflow_id uuid,
  run_id uuid,
  symbol text NOT NULL,
  action text NOT NULL,           -- matches backtest_trades.action
  quantity numeric NOT NULL,
  "entryPrice" numeric,
  "entryTime" timestamptz,
  "exitPrice" numeric NOT NULL,
  "exitTime" timestamptz NOT NULL,
  commission numeric DEFAULT 0,
  slippage numeric DEFAULT 0,
  net_pnl numeric,
  gross_pnl numeric,
  entry_order_id text,
  exit_order_id text,
  holding_period_bars integer DEFAULT 0,
  exit_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.live_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own live trades"
  ON public.live_trades FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to live_trades"
  ON public.live_trades FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_live_trades_workflow ON public.live_trades (workflow_id, run_id);
```

### Step 2: Backend — Persist trades on close

**File: `coreza-backend/src/repositories/LiveTradeRepository.ts`** (new)

Simple repository with `batchUpsert` method, similar to `LiveFillRepository`.

**File: `coreza-backend/src/simulation/PortfolioManager.ts`**

Change `applyTrade()` to return the `Trade` object instead of void.

**File: `coreza-backend/src/nodes/executors/PortfolioExecutor.ts`**

After `applyTrade()` returns a trade, insert it into `live_trades` via `LiveTradeRepository`. Direct insert is fine since trade closes are infrequent events.

### Step 3: Frontend — Query `live_trades` instead of parsing `workflow_runs.result`

**File: `src/hooks/useLiveStrategyDetail.ts`**

- Replace the `workflow_runs.result` portfolio node parsing (lines 257-284) with a query to `live_trades`:
  ```
  SELECT * FROM live_trades
  WHERE workflow_id = ? AND run_id = ?
  ORDER BY "exitTime" ASC
  ```
- Map results to `BacktestTrade[]` (same interface used by backtest)
- For expandable order details: match `live_fills` by `entry_order_id` / `exit_order_id`
- Remove `mapFillToTrade` fallback entirely
- Remove `closedTradesRef` and `portfolioSummary` state

**File: `src/lib/liveMetrics.ts`**

- Remove `portfolioSummary` parameter dependency
- Compute all trade-derived metrics from `live_trades` data (same `netPnl` shape already works)
- Keep `cash_snapshots` for equity curve / risk metrics

### Step 4: UI updates

**File: `src/pages/BacktestResults.tsx`** — Change live tab label from "Fills" to "Trades"

**File: `src/components/backtest/TradesTable.tsx`** — Update empty state to "No closed trades yet."

## Data Flow After Fix

```text
BACKTEST (unchanged):
  BacktestExecutor → INSERT backtest_trades, backtest_results, backtest_portfolio_snapshots
  Frontend: useBacktestResults → SELECT from 3 backtest_* tables

LIVE (fixed):
  PortfolioManager.applyTrade() → LiveTradeRepository → INSERT live_trades
  FillSyncWorker → INSERT live_fills (for order expansion detail)
  SnapshotCache → INSERT cash_snapshots (for equity curve)
  Frontend: useLiveStrategyDetail → SELECT live_trades + cash_snapshots
            + SELECT live_fills WHERE order_id IN (entry/exit) for expansion
```

## Why This is Better Than Unification

- Zero risk to existing backtest functionality
- No data migration needed
- No RLS policy rewrites
- No `supabase/types.ts` regeneration issues
- Frontend `BacktestTrade` interface already serves as the shared contract
- Each mode queries its own tables cleanly

## Files to Create/Modify

| File | Change |
|------|--------|
| Migration SQL | Create `live_trades` table with RLS |
| `coreza-backend/src/repositories/LiveTradeRepository.ts` | New — insert closed trades |
| `coreza-backend/src/simulation/PortfolioManager.ts` | Return `Trade` from `applyTrade()` |
| `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` | Insert to `live_trades` after trade close |
| `src/hooks/useLiveStrategyDetail.ts` | Query `live_trades`, remove fill fallback and portfolio node parsing |
| `src/lib/liveMetrics.ts` | Remove `portfolioSummary` dependency |
| `src/pages/BacktestResults.tsx` | Tab label change |
| `src/components/backtest/TradesTable.tsx` | Empty state text |

