

# Simplify Portfolio Node — Remove Granular Execution Fields

## What the user wants

Remove 9 fields from the Portfolio node UI and simplify the executor logic. Keep only the essentials: **filled_qty**, **avg_fill_price**, **fee_amount**, **fee_asset** (plus existing identity/status fields).

## Fields to remove

| Field | Key | Currently used by |
|---|---|---|
| Execution Quantity | `exec_qty` | `apply_execution`, `sync_order_event` |
| Cumulative Filled Quantity | `cum_filled_qty` | `apply_order_update`, `apply_execution`, `sync_order_event` |
| Position Quantity | `position_qty` | `reconcile_position`, `sync_order_event` |
| Remaining Quantity | `remaining_qty` | `apply_order_update`, `sync_order_event` |
| Execution Price | `exec_price` | `apply_execution`, `sync_order_event` |
| Market Price | `market_price` | `update_mtm`, `sync_order_event` |
| Quote Notional | `quote_notional` | `apply_execution`, `sync_order_event` |
| Apply Position Delta | `apply_position_delta` | `apply_execution`, `sync_order_event` |
| Realized PnL | `realized_pnl` | `reconcile_position`, `sync_order_event` |

## Fields to keep (for execution/fill operations)

- `filled_qty` (new field — replaces cum_filled_qty, labeled "Filled Quantity")
- `avg_fill_price` (already exists — rename label to "Average Price")
- `fee_amount` (keep as-is)
- `fee_asset` (keep as-is)
- `orig_qty` (keep — needed for register_order_intent and order updates)

## Operations affected

### `apply_execution` — Simplify to use filled_qty + avg_fill_price

Currently requires `exec_qty` and `exec_price`. After simplification:
- **Input**: `filled_qty` (cumulative), `avg_fill_price`, `fee_amount`, `fee_asset`
- **Executor internally**: derives `exec_qty` = `filled_qty - order.cumFilledQty` (delta from previous state tracked in OrderState)
- **Executor internally**: uses `avg_fill_price` as `exec_price` (approximation, sufficient for simple workflows)
- **PortfolioManager.applyExecution()** stays unchanged — executor just computes the params it needs
- `applyPositionDelta` always `true` (default) — no toggle needed since `reconcile_position` is being removed from sync_order_event

### `apply_order_update` — Remove cum_filled_qty, remaining_qty

- These were optional enrichments. The order state already tracks them internally via `applyExecution`.
- Keep `status` and `avg_fill_price` only.

### `sync_order_event` — Major simplification

Currently accepts 20+ fields. Simplified to:
- `symbol`, `broker_order_id`, `client_order_id`, `execution_id` (identity)
- `status`, `side` (order lifecycle)
- `filled_qty`, `avg_fill_price` (fill data)
- `fee_amount`, `fee_asset` (fees)
- `orig_qty` (order size)

Orchestration stays the same: ownership check → order update → execution → but no `reconcilePosition` sub-call.

### `reconcile_position` — Keep the operation but remove `position_qty` from sync_order_event

The standalone `reconcile_position` operation stays available (it's needed for advanced Alpaca/Binance flows later). Only remove `position_qty` from `sync_order_event`'s display options and its sub-call in the composite.

### `update_mtm` — Keep but `market_price` stays for this operation only

`market_price` is needed for `update_mtm` specifically. Remove it from `sync_order_event` display options but keep it for `update_mtm`.

## Changes by file

### 1. `src/nodes/Portfolio.json`

- Remove field definitions: `exec_qty`, `cum_filled_qty`, `position_qty`, `remaining_qty`, `exec_price`, `quote_notional`, `apply_position_delta`, `realized_pnl`
- Add new field `filled_qty` (label "Filled Quantity", shown for `apply_execution`, `apply_order_update`, `sync_order_event`)
- Remove `market_price` from `sync_order_event` display options (keep for `update_mtm` only)
- Update `avg_fill_price` display options to include `apply_execution` and `sync_order_event`

### 2. `coreza-backend/src/nodes/executors/PortfolioExecutor.ts`

**`brokerApplyExecution`**:
- Accept `filled_qty` + `avg_fill_price` instead of `exec_qty` + `exec_price`
- Derive `execQty` internally: look up the order's current `cumFilledQty` from `pm`, compute delta
- Add a public method `getOrderCumFilledQty(brokerOrderId)` to PortfolioManager (or use existing order state)
- Pass derived values to `pm.applyExecution()` (unchanged interface)

**`brokerApplyOrderUpdate`**:
- Remove `cumFilledQty` and `remainingQty` from params (they'll be set by applyExecution internally)

**`parseSyncOrderEventParams`**:
- Replace `execQty`, `execPrice`, `cumFilledQty`, `remainingQty`, `positionQty`, `quoteNotional`, `realizedPnl`, `marketPrice`, `applyPositionDelta` with `filledQty` and `avgFillPrice`

**`brokerSyncOrderEvent`**:
- Remove the `reconcilePosition` sub-call block (lines 699-708)
- Execution sub-call: derive `exec_qty` from `filled_qty - previousCumFilledQty` (same logic as simplified `brokerApplyExecution`)
- Remove `position_reconciled` from result

### 3. `coreza-backend/src/simulation/PortfolioManager.ts`

- Add public method: `getOrderCumFilledQty(brokerOrderId: string): number` — returns the order's current `cumFilledQty` from the v2 `orders` map (returns 0 if not found)
- No other changes — `applyExecution()`, `reconcilePosition()`, `applyOrderUpdate()` interfaces stay as-is

### 4. `coreza-backend/src/routes/portfolio.ts`

- Add `filled_qty` to the Zod schema
- Keep all existing v2 fields in schema (they're still valid for direct API calls, just hidden from UI)

## What stays unchanged

- `PortfolioManager.applyExecution()` internal interface — still takes `execQty`, `execPrice`
- `reconcile_position` and `reconcile_balances` standalone operations — still available
- Backtest mode — completely untouched
- Legacy operations (`update_portfolio`, `register_order`) — untouched
- All internal v2 state maps — no changes

## Trade-offs

- **Loss of precision**: Using `avg_fill_price` as `exec_price` for partial fills is an approximation. For a fill of 0.4 @ 2120 then 0.6 @ 2130, the second execution would use the cumulative avg (2126) instead of exact 2130. This is acceptable "for now" as the user stated.
- **No position reconciliation in sync_order_event**: The 0.9982 Alpaca qty fix won't work through sync_order_event. Users needing that must use the standalone `reconcile_position` operation. Can be added back later.

