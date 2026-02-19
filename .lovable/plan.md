

# Enhanced Trade Log and QuantConnect-Style Backtest Results

## Problems Found

### 1. Trade Log Only Records Sell-Side Exits
The current `executeBacktestResults` (line 415-431) only persists entries from `simBroker.getTrades()`, which are **closed trade records** (sell fills only). BUY entries are never saved to the `backtest_trades` table. The user's desired log format shows both BUY and SELL entries chronologically:

```
2025-07-17 14:31:00 SELL (TAKE PROFIT) 4.10%
2025-07-21 09:38:00 BUY @ 24.12
```

### 2. Missing Trade Data Fields
The current `backtest_trades` DB schema and Trade interface are missing key fields needed for the desired log format:
- **Exit reason** (TAKE PROFIT, STOP LOSS, SIGNAL, etc.)
- **Return percentage** per trade
- **Entry price** on sell rows (needed to calculate return %)
- **Portfolio value before/after** (always null currently)

### 3. BacktestResults Node Output Missing QC-Style Metrics
The current results output is missing several QuantConnect standard metrics:
- Sortino Ratio, Calmar Ratio (calculated but not persisted to DB)
- Profit Factor
- Average Win / Average Loss
- Total Commission / Total Slippage
- Expectancy (avg win * win rate - avg loss * loss rate)
- Compounding Annual Return (CAR)
- Net Profit (absolute $)
- Average Holding Period

---

## Implementation Plan

### File 1: DB Schema -- Add columns to `backtest_trades` and `backtest_results`

**`backtest_trades` -- add columns:**
- `entry_price` (numeric) -- the avg entry price when this was a sell
- `exit_reason` (text) -- "TAKE_PROFIT", "STOP_LOSS", "SIGNAL", "MANUAL"
- `return_pct` (numeric) -- percentage return on this trade
- `side` (text) -- "buy" or "sell" (currently stored in `action` but rename for clarity)
- `net_pnl` (numeric) -- net P&L for sell trades
- `holding_period_bars` (integer) -- bars held

**`backtest_results` -- add columns:**
- `sortino_ratio` (numeric)
- `calmar_ratio` (numeric)
- `profit_factor` (numeric)
- `avg_win` (numeric)
- `avg_loss` (numeric)
- `total_commission` (numeric)
- `total_slippage` (numeric)
- `net_profit` (numeric)
- `losing_trades` (integer)
- `expectancy` (numeric)
- `avg_holding_period` (numeric)

Run via SQL migration on Supabase.

### File 2: `coreza-backend/src/services/simBroker/index.ts` -- Track ALL order fills

**Add a new array to PortfolioState** to record every fill (buy AND sell) chronologically:

```typescript
// Add to PortfolioState interface in interfaces.ts:
interface OrderLogEntry {
  timestamp: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;         // fill price
  entryPrice?: number;   // avg entry price (for sells)
  exitReason?: string;   // TAKE_PROFIT, STOP_LOSS, SIGNAL
  returnPct?: number;    // % return (for sells)
  netPnl?: number;       // net P&L (for sells)
  commission: number;
  slippage: number;
  portfolioValueBefore: number;
  portfolioValueAfter: number;
  holdingPeriodBars?: number;
  orderId: string;
}
```

**Modify `applyFill()` in SimBroker** to push an `OrderLogEntry` for EVERY fill:

- **BUY fill:** Log with `side: 'buy'`, `price` (fill price), `portfolioValueBefore` (equity before), `portfolioValueAfter` (equity after)
- **SELL fill:** Log with `side: 'sell'`, `price` (exit price), `entryPrice` (avg entry), `returnPct` ((exitPrice - entryPrice) / entryPrice * 100), `netPnl`, `exitReason` from a new parameter or inferred

**Add `exit_reason` inference:** When a sell trade is executed, determine the reason:
- Check if a stop order triggered -> "STOP_LOSS"
- Check if limit order triggered -> "TAKE_PROFIT"
- Market order sell -> "SIGNAL"
- This can be inferred from `order.type`: limit sells = TAKE_PROFIT, stop sells = STOP_LOSS, market sells = SIGNAL

### File 3: `coreza-backend/src/services/simBroker/interfaces.ts` -- Add types

Add the `OrderLogEntry` interface and the `orderLog: OrderLogEntry[]` field to `PortfolioState`.

### File 4: `coreza-backend/src/nodes/executors/BacktestExecutor.ts` -- Persist full trade log

**Modify `executeBacktestResults`** (line 415-431):

Replace the current trade persistence that only saves closed trades with a full order log:

```typescript
// Instead of just trades (sell-side only):
const orderLog = simBroker.getOrderLog();

if (orderLog.length > 0) {
  const tradeRows = orderLog.map((entry) => ({
    backtest_id: backtestId,
    symbol: entry.symbol,
    action: entry.side,
    quantity: entry.quantity,
    price: entry.price,
    timestamp: entry.timestamp,
    commission: entry.commission,
    slippage: entry.slippage,
    portfolio_value_before: entry.portfolioValueBefore,
    portfolio_value_after: entry.portfolioValueAfter,
    entry_price: entry.entryPrice || null,
    exit_reason: entry.exitReason || null,
    return_pct: entry.returnPct || null,
    net_pnl: entry.netPnl || null,
    holding_period_bars: entry.holdingPeriodBars || null,
  }));

  await supabaseClient.from("backtest_trades").insert(tradeRows);
}
```

**Also persist additional QC-style metrics to `backtest_results`:**

```typescript
await supabaseClient.from("backtest_results").insert({
  backtest_id: backtestId,
  // Existing fields...
  total_return: metrics.totalReturnPct,
  annualized_return: metrics.annualizedReturn,
  // NEW fields:
  sortino_ratio: metrics.sortinoRatio,
  calmar_ratio: metrics.calmarRatio,
  profit_factor: metrics.profitFactor,
  avg_win: metrics.avgWin,
  avg_loss: metrics.avgLoss,
  total_commission: metrics.totalCommission,
  total_slippage: metrics.totalSlippage,
  net_profit: metrics.totalReturn,
  losing_trades: metrics.losingTrades,
  expectancy: calculateExpectancy(metrics),
  avg_holding_period: calculateAvgHoldingPeriod(trades),
});
```

**Update the node output** to include QC-formatted summary:

```typescript
return toNodeResult(createSuccessOutput({
  backtest_id: backtestId,
  // QC-style summary section
  statistics: {
    total_return: `${metrics.totalReturnPct.toFixed(2)}%`,
    net_profit: `$${metrics.totalReturn.toFixed(2)}`,
    annualized_return: `${metrics.annualizedReturn.toFixed(2)}%`,
    sharpe_ratio: metrics.sharpeRatio.toFixed(3),
    sortino_ratio: metrics.sortinoRatio.toFixed(3),
    calmar_ratio: metrics.calmarRatio.toFixed(3),
    max_drawdown: `${metrics.maxDrawdownPct.toFixed(2)}%`,
    profit_factor: metrics.profitFactor.toFixed(2),
    win_rate: `${metrics.winRate.toFixed(1)}%`,
    total_trades: metrics.totalTrades,
    winning_trades: metrics.winningTrades,
    losing_trades: metrics.losingTrades,
    avg_win: `$${metrics.avgWin.toFixed(2)}`,
    avg_loss: `$${metrics.avgLoss.toFixed(2)}`,
    largest_win: `$${metrics.largestWin.toFixed(2)}`,
    largest_loss: `$${metrics.largestLoss.toFixed(2)}`,
    expectancy: `$${expectancy.toFixed(2)}`,
    total_commission: `$${metrics.totalCommission.toFixed(2)}`,
    total_slippage: `$${metrics.totalSlippage.toFixed(2)}`,
    initial_capital: `$${initialCapital.toFixed(2)}`,
    final_equity: `$${finalEquity.toFixed(2)}`,
    start_date: metrics.startDate,
    end_date: metrics.endDate,
    total_bars: metrics.totalBars,
  },
  // Trade log for output panel
  trade_log: orderLog.map(e => ({
    time: e.timestamp,
    action: e.side.toUpperCase(),
    symbol: e.symbol,
    price: e.price,
    quantity: e.quantity,
    reason: e.exitReason || null,
    return_pct: e.returnPct ? `${e.returnPct.toFixed(2)}%` : null,
    net_pnl: e.netPnl ? `$${e.netPnl.toFixed(2)}` : null,
  })),
  trades_count: orderLog.length,
  equity_points: equityCurve.length,
}));
```

### File 5: Frontend -- `src/hooks/useBacktestResults.ts` -- Update types

Add new fields to `BacktestResultMetrics`:

```typescript
export interface BacktestResultMetrics {
  // existing...
  sortino_ratio?: number;
  calmar_ratio?: number;
  profit_factor?: number;
  avg_win?: number;
  avg_loss?: number;
  total_commission?: number;
  total_slippage?: number;
  net_profit?: number;
  losing_trades?: number;
  expectancy?: number;
  avg_holding_period?: number;
}

export interface BacktestTrade {
  // existing...
  entry_price?: number;
  exit_reason?: string;
  return_pct?: number;
  net_pnl?: number;
  holding_period_bars?: number;
}
```

### File 6: Frontend -- `src/components/backtest/TradesTable.tsx` -- QC-Style Trade Log

Redesign the table to show trades like the user's desired format:

- Show BUY rows: `2025-07-21 09:38:00 BUY @ 24.12`
- Show SELL rows: `2025-07-17 14:31:00 SELL (TAKE PROFIT) 4.10%`
- Color code: green for BUY, red for SELL
- Show return % badge on sell rows (green if positive, red if negative)
- Add exit reason badge (TAKE PROFIT / STOP LOSS / SIGNAL)
- Add portfolio value before/after columns
- Add net P&L column for sell rows

New columns: `Time | Action | Symbol | Price | Qty | Reason | Return % | Net P&L | Portfolio Value`

### File 7: Frontend -- `src/components/backtest/PerformanceMetricsCard.tsx` -- QC-Style Layout

Reorganize into sections matching QuantConnect's results page:

**Section 1: Key Performance**
- Net Profit, Total Return %, Annualized Return %, Final Equity

**Section 2: Risk Metrics**
- Sharpe Ratio, Sortino Ratio, Calmar Ratio, Max Drawdown %

**Section 3: Trade Statistics**
- Total Trades, Winning/Losing, Win Rate %, Profit Factor

**Section 4: P&L Analysis**
- Avg Win, Avg Loss, Largest Win, Largest Loss, Expectancy

**Section 5: Costs**
- Total Commission, Total Slippage

### File 8: Frontend -- `src/pages/BacktestResults.tsx` -- Update top metric cards

Update the 4 summary cards at top to show:
1. Net Profit ($) with green/red color
2. Total Return (%) with green/red color
3. Sharpe Ratio
4. Win Rate (%)

---

## Files Summary

| File | Action | Description |
|---|---|---|
| SQL Migration | **Run** | Add columns to `backtest_trades` and `backtest_results` |
| `coreza-backend/src/services/simBroker/interfaces.ts` | **Modify** | Add `OrderLogEntry` interface, add `orderLog` to `PortfolioState` |
| `coreza-backend/src/services/simBroker/index.ts` | **Modify** | Log every fill (buy + sell) with portfolio values, exit reason, return % |
| `coreza-backend/src/nodes/executors/BacktestExecutor.ts` | **Modify** | Persist full order log + additional QC metrics |
| `src/hooks/useBacktestResults.ts` | **Modify** | Add new metric and trade fields to types |
| `src/components/backtest/TradesTable.tsx` | **Modify** | Redesign as chronological trade log with BUY/SELL, reason, return % |
| `src/components/backtest/PerformanceMetricsCard.tsx` | **Modify** | QC-style sectioned metrics layout |
| `src/pages/BacktestResults.tsx` | **Modify** | Update top summary cards |

