
# Complete Fix Plan: Build Error + backtest_results Empty + QuantConnect-Style List

## What Was Found (Confirmed from Code + DB)

### Issue 1: Build Error — `updated_at` (BLOCKING)
`src/pages/Backtests.tsx` line 178 references `backtest.updated_at` but:
- The `Backtest` interface in `useBacktests.ts` does NOT have `updated_at` (correctly removed previously)
- The `backtests` DB table also has NO `updated_at` column

Fix: Replace `backtest.updated_at` with `backtest.created_at` on line 178 (one line change).

---

### Issue 2: `backtest_results` Has Zero Rows (Root Cause Found)

**Two compounding bugs found:**

**Bug A — Missing table definitions in backend Supabase types:**
`coreza-backend/src/types/supabase.ts` only defines `workflows`, `workflow_runs`, `node_executions`, and `user_credentials`. It does NOT define `backtest_results`, `backtest_trades`, or `backtest_portfolio_snapshots`.

When the backend calls `supabaseClient.from("backtest_results").insert(...)`, the typed Supabase client (created with `createClient<Database>`) has no knowledge of this table. The insert **fails silently** — there is no `const { error } = await ...` check on the `backtest_results` insert, so the error is swallowed and execution continues to `backtest_trades` (which also isn't typed but the error handling behavior may differ, or it was using a loose type path).

**Bug B — No error checking on the insert:**
Line 337-372 in `BacktestExecutor.ts`:
```typescript
// CURRENT — error is silently swallowed:
await supabaseClient.from("backtest_results").insert({ ... });

// SHOULD BE:
const { error: resultsError } = await supabaseClient.from("backtest_results").insert({ ... });
if (resultsError) console.error('[BacktestExecutor] Failed to insert backtest_results:', resultsError);
```

---

### Issue 3: QuantConnect-Style List View

The current card grid shows backtests with 2 metric boxes per card. QuantConnect uses a dense **table/list layout** showing many backtests at once with columns: Name, Workflow, Status, Return, Sharpe, Trades, Date.

---

## All Files to Change

### File 1: `coreza-backend/src/types/supabase.ts` — Add missing table types

Add `backtests`, `backtest_results`, `backtest_trades`, and `backtest_portfolio_snapshots` to the `Database` interface. This is the primary fix for `backtest_results` being empty — it ensures the typed Supabase client knows these tables exist.

```typescript
backtests: {
  Row: {
    id: string;
    user_id: string;
    workflow_id: string;
    name: string;
    description: string | null;
    start_date: string;
    end_date: string;
    initial_capital: number;
    commission_rate: number | null;
    slippage_rate: number | null;
    data_frequency: string;
    status: string;
    error_message: string | null;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
  };
  Insert: { /* all fields optional except required ones */ };
  Update: { /* all fields optional */ };
};
backtest_results: {
  Row: {
    id: string;
    backtest_id: string;
    total_return: number | null;
    annualized_return: number | null;
    max_drawdown: number | null;
    sharpe_ratio: number | null;
    sortino_ratio: number | null;
    calmar_ratio: number | null;
    total_trades: number | null;
    win_rate: number | null;
    profitable_trades: number | null;
    losing_trades: number | null;
    average_trade_return: number | null;
    largest_win: number | null;
    largest_loss: number | null;
    final_portfolio_value: number | null;
    profit_factor: number | null;
    avg_win: number | null;
    avg_loss: number | null;
    total_commission: number | null;
    total_slippage: number | null;
    net_profit: number | null;
    expectancy: number | null;
    avg_holding_period: number | null;
    created_at: string;
  };
  Insert: { /* backtest_id required, rest optional */ };
  Update: { /* all optional */ };
};
backtest_trades: { Row: {...}; Insert: {...}; Update: {...}; };
backtest_portfolio_snapshots: { Row: {...}; Insert: {...}; Update: {...}; };
```

### File 2: `coreza-backend/src/nodes/executors/BacktestExecutor.ts` — Add error checking on inserts

Add `const { error } = await ...` error checks to the `backtest_results` insert and log any failures so they're visible in the backend logs:

```typescript
// Line 337 — add error destructuring and logging:
const { error: resultsError } = await supabaseClient.from("backtest_results").insert({
  backtest_id: backtestId,
  total_return: metrics.totalReturnPct,
  // ... all existing fields unchanged ...
});
if (resultsError) {
  console.error('[BacktestExecutor] Failed to insert backtest_results:', resultsError);
}

// Also add error check for trades insert (line 389):
const { error: tradesError } = await supabaseClient.from("backtest_trades").insert(tradeRows);
if (tradesError) {
  console.error('[BacktestExecutor] Failed to insert backtest_trades:', tradesError);
}

// Also add error check for snapshots insert (line 414-418):
const { error: snapshotError } = await supabaseClient.from("backtest_portfolio_snapshots").insert(snapshots.slice(i, i + 500));
if (snapshotError) {
  console.error('[BacktestExecutor] Failed to insert backtest_portfolio_snapshots batch:', snapshotError);
}
```

### File 3: `src/pages/Backtests.tsx` — Fix build error + QuantConnect-style table layout

**Change A (build error fix) — line 178:**
```tsx
// Remove:
{backtest.updated_at ? new Date(backtest.updated_at).toLocaleString() : ''}
// Replace with:
{backtest.created_at ? new Date(backtest.created_at).toLocaleString() : ''}
```

**Change B — Replace card grid with QuantConnect-style table:**

Replace the `<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">` card grid (lines 144-199) with a `<Table>` layout. Each row shows:

| Column | Value |
|---|---|
| Name | Clickable link to results page |
| Workflow | `workflow_name` (or "—") |
| Status | Colored badge |
| Total Return | Green/red % or "—" |
| Sharpe Ratio | Number or "—" |
| Trades | `total_trades` or "—" |
| Created | Formatted date |
| Actions | View / Delete dropdown |

Keep the loading skeleton rows, empty state, and search/filter logic unchanged. Only the rendered list changes from cards to a table.

### File 4: `src/hooks/useBacktests.ts` — Add `total_trades` to query + interface

```typescript
// Add to Backtest interface:
total_trades?: number;

// Update the select:
backtest_results(total_return, sharpe_ratio, total_trades)

// Add to parsed map:
total_trades: item.backtest_results?.[0]?.total_trades,
```

---

## Summary

| # | File | Change | Fixes |
|---|---|---|---|
| 1 | `coreza-backend/src/types/supabase.ts` | Add `backtests`, `backtest_results`, `backtest_trades`, `backtest_portfolio_snapshots` types | Primary fix: `backtest_results` insert now works with typed client |
| 2 | `coreza-backend/src/nodes/executors/BacktestExecutor.ts` | Add error checks to all 3 inserts | Surfaces any future insert errors in backend logs |
| 3 | `src/pages/Backtests.tsx` | Replace `updated_at` → `created_at` on line 178; replace card grid with table | Fixes build error; QuantConnect-style list |
| 4 | `src/hooks/useBacktests.ts` | Add `total_trades` to query + interface | Shows trade count in table |

## Expected Result After Fix

1. Build error gone immediately (single line change)
2. After running a new backtest, `backtest_results` will have a row with all metrics (Sharpe, Sortino, Calmar, Win Rate, etc.)
3. The backtests list shows a clean table with Name, Status, Return, Sharpe, Trades columns
4. Existing 3 completed backtests will still show "—" for metrics (their runs happened before this fix — no data was written then)
