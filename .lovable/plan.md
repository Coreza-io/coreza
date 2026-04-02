

# Plan: Redesign TradesTable to Show Trades with Expandable Orders

## Current Problem

The `TradesTable` currently shows **raw fills** (individual order executions) as flat rows. The reference screenshots show a different UX:

1. **Primary rows** = Closed trades (entry→exit pairs) showing: Entry Time, Symbol, Exit Time, Direction, Entry Price, Exit Price, Quantity, P&L, Fees, MAE, MFE, Drawdown, Result (Win/Loss)
2. **Expandable sub-rows** = When clicking a trade row, show the individual orders/fills that make up that trade (e.g., "Buy Market Fill: $7.92 USD 1265 Filled" and "Sell Market Fill: $8.20 USD -1265 Filled Liquidated")

## Data Available

The backend already produces closed `Trade` objects (via `PortfolioManager.applyTrade()`) with:
- `id`, `symbol`, `side`, `entryPrice`, `exitPrice`, `quantity`, `grossPnl`, `commission`, `netPnl`, `entryTime`, `exitTime`, `entryOrderId`, `exitOrderId`

These are passed to the frontend via `portfolio_summary.trades` in `workflow_runs.result`.

The `live_fills` table has individual fill events with: `order_id`, `side`, `price`, `qty`, `commission`, `event_time`, `symbol`.

## Implementation

### Step 1: Extend `BacktestTrade` interface

Add optional fields to support the new columns and expandable orders:

```typescript
// In useBacktestResults.ts
export interface BacktestTrade {
  // ... existing fields ...
  grossPnl?: number | null;
  fees?: number | null;          // alias for commission
  result?: "Win" | "Loss" | null;
  orders?: TradeOrder[];         // child fills/orders for expansion
}

export interface TradeOrder {
  id: string;
  symbol: string;
  side: string;
  orderType?: string;            // "Market", "Limit", etc.
  fillPrice: number;
  quantity: number;
  status?: string;               // "Filled"
  exitReason?: string;           // "Liquidated", etc.
  time: string;
}
```

### Step 2: Update `mapClosedTradeToBacktestTrade` in `useLiveStrategyDetail.ts`

Map the new fields from the backend `Trade` object:
- `fees` from `trade.commission`
- `grossPnl` from `trade.grossPnl`
- `result` = `trade.netPnl >= 0 ? "Win" : "Loss"`
- `entryOrderId` and `exitOrderId` preserved for linking fills

### Step 3: Link fills to trades as child orders

After loading both `latestClosedTrades` and `fillMappedTrades`, group fills by `order_id` matching `entryOrderId`/`exitOrderId` on each trade. Attach matched fills as `trade.orders[]`.

```text
For each closed trade:
  orders = fills.filter(f => 
    f.order_id === trade.entryOrderId || f.order_id === trade.exitOrderId
  )
  Map each fill → TradeOrder { side, orderType, fillPrice, quantity, status, time }
```

### Step 4: Redesign `TradesTable.tsx`

**Main trade row columns** (matching reference screenshots):
- Entry Time, Symbol, Exit Time, Direction (Buy/Sell), Entry Price, Exit Price, Quantity, P&L, Fees, Result (Win/Loss badge)
- Expand/collapse toggle icon (`+`/`-`) on the left

**Expanded sub-section** (when clicked):
- Header: "Orders"
- Sub-rows with tree-line styling showing each order/fill:
  - Time, Symbol, Side + Order Type (e.g., "Buy Market"), Fill Price, Quantity, Status ("Filled"), Exit Reason if applicable

**State management**: Use local `expandedTradeIds: Set<string>` state to track which trade rows are expanded.

### Step 5: Handle backtest mode

For backtest mode, trades come from `backtest_trades` table which has the same shape. The `orders` field will be empty/undefined since backtest trades don't have separate fill records. The expand toggle simply won't appear when `orders` is empty.

## Files to modify

| File | Change |
|------|--------|
| `src/hooks/useBacktestResults.ts` | Add `TradeOrder` interface, extend `BacktestTrade` with `grossPnl`, `fees`, `result`, `orders` |
| `src/hooks/useLiveStrategyDetail.ts` | Map new trade fields, link fills to trades as child orders |
| `src/components/backtest/TradesTable.tsx` | Full redesign with expandable rows |

## Key design decisions

- P&L, Fees, Result shown only on **trade rows** (not order sub-rows) — matching reference
- Order sub-rows show fill-level detail: price, qty, status, exit reason
- Backtest trades work unchanged (no orders to expand)
- No new backend changes needed — all data already available

