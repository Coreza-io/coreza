
# Plan: Create `live_trades` Table (Mirror Backtest Pattern) — ✅ IMPLEMENTED

## What was done

### Database
- Created `live_trades` table mirroring `backtest_trades` structure with live-appropriate FKs (`user_id`, `workflow_id`, `run_id`)
- RLS: authenticated users see own trades, service_role has full access

### Backend (`coreza-backend`)
- **`LiveTradeRepository.ts`** — New repository to insert closed trades
- **`PortfolioManager.ts`** — `applyTrade()` now returns `Trade | null` instead of `void`
- **`PortfolioExecutor.ts`** — After `applyTrade()` returns a trade, persists it to `live_trades` via `LiveTradeRepository` (gated by `isLive`)

### Frontend
- **`useLiveStrategyDetail.ts`** — Queries `live_trades` directly instead of parsing `workflow_runs.result`. Links `live_fills` for expandable order details. Removed `mapFillToTrade` fallback, `closedTradesRef`, and `portfolioSummary` state.
- **`BacktestResults.tsx`** — Tab label changed from "Fills" to "Trades"
- **`TradesTable.tsx`** — Empty state updated to "No closed trades yet."

## Data Flow

```
LIVE:
  PortfolioManager.applyTrade() → LiveTradeRepository → INSERT live_trades
  FillSyncWorker → INSERT live_fills (for order expansion detail)
  SnapshotCache → INSERT cash_snapshots (for equity curve)
  Frontend: SELECT live_trades + cash_snapshots + live_fills (for expansion)
```
