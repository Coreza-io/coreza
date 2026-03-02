

# Unified Portfolio Node -- Replace BacktestPortfolio with Generic Portfolio

## Problem

Currently `BacktestPortfolio.json` is hardcoded to the Backtest category and `SimBroker`. The user wants a single `Portfolio` node that works for both backtest and live (broker) contexts, avoiding duplicate nodes.

## Design

A single `Portfolio.json` node with a **mode** field (`backtest` vs `broker`) that determines the data source. The output shape stays identical -- positions, cash, equity, PnL -- regardless of mode. This follows the existing config-driven architecture principle.

### How it works

- **Backtest mode**: Routes to existing `SimBroker` logic (unchanged behavior)
- **Broker mode**: Routes to the new `PortfolioManager` which bootstraps from Binance Spot APIs (`/api/v3/account` for balances, `/api/v3/myTrades` for cost basis) and maintains in-memory state with async Supabase persistence

The operations remain the same across both modes: `get_portfolio`, `get_position`, `get_cash`, `get_equity`, `get_pending_orders`, `get_trades`, `update_mtm` (backtest only), `sync_trades` (broker only).

## Changes

### 1. Frontend: Replace `BacktestPortfolio.json` with `Portfolio.json`

**Delete**: `src/nodes/BacktestPortfolio.json`
**Create**: `src/nodes/Portfolio.json`

```text
- name: "Portfolio"
- def: "Portfolio"
- category: "Utility" (or a new "Portfolio" category)
- icon: reuse backtest icon or a generic portfolio icon
- Fields:
  - mode: select ["backtest", "broker"] (default: "backtest")
  - backtest_id: text (shown when mode = backtest)
  - credential_id: text (shown when mode = broker)
  - broker: select ["binance"] (shown when mode = broker)
  - operation: select (shared operations + mode-specific ones)
  - symbol: text (shown for get_position, update_mtm, sync_trades)
  - current_bar: textarea (shown for update_mtm, mode = backtest only)
```

### 2. Database: Supabase migration for persistence tables

Create three tables for the broker-mode fill ledger and snapshots:

**`live_fills`** -- Event-sourced fill history
- `id` (uuid PK), `user_id` (uuid), `broker` (text), `credential_id` (uuid), `symbol` (text), `trade_id` (text), `order_id` (text), `side` (text), `qty` (numeric), `price` (numeric), `quote_qty` (numeric), `commission` (numeric), `commission_asset` (text), `event_time` (timestamptz), `created_at` (timestamptz)
- Unique on `(user_id, broker, symbol, trade_id)`
- RLS: `auth.uid() = user_id`

**`position_snapshots`** -- Periodic portfolio state
- `id` (uuid PK), `user_id` (uuid), `broker` (text), `credential_id` (uuid), `symbol` (text), `quantity` (numeric), `avg_entry_price` (numeric), `current_price` (numeric), `unrealized_pnl` (numeric), `realized_pnl` (numeric), `snapshot_at` (timestamptz), `created_at` (timestamptz)
- RLS: `auth.uid() = user_id`

**`cash_snapshots`** -- Cash balance snapshots
- `id` (uuid PK), `user_id` (uuid), `broker` (text), `credential_id` (uuid), `balances` (jsonb), `total_value_usdt` (numeric), `snapshot_at` (timestamptz), `created_at` (timestamptz)
- RLS: `auth.uid() = user_id`

### 3. Backend: `PortfolioManager` service

**Create**: `coreza-backend/src/services/PortfolioManager.ts`

In-memory portfolio engine for live broker mode. Reuses the same `Position` and `PortfolioState` interfaces from `simBroker/interfaces.ts`.

Key methods:
- `bootstrap(broker, creds, symbols)` -- Fetch `/api/v3/account` for cash, load persisted fills from Supabase, fetch new fills from `/api/v3/myTrades` using `fromId`, replay all fills to derive avg entry and realized PnL
- `applyFill(fill)` -- Same weighted-average math as SimBroker's position update logic; async persist to `live_fills`
- `syncFromBroker(symbols)` -- Incremental trade fetch using `fromId`
- `getPortfolioState()` -- Returns same `PortfolioState` shape as SimBroker
- `getPosition(symbol)`, `getCash()`, `getEquity()` -- Mirror SimBroker methods
- `snapshotToDb()` -- Periodic persistence of position and cash snapshots

Static instance cache keyed by `${userId}:${credentialId}`.

### 4. Backend: `PortfolioExecutor` (new executor)

**Create**: `coreza-backend/src/nodes/executors/PortfolioExecutor.ts`

Registered with category `"Portfolio"`. Routes based on `mode`:

- **backtest**: Delegates to existing SimBroker logic (extract the portfolio methods from `BacktestExecutor` into shared helpers or call SimBroker directly)
- **broker**: Delegates to `PortfolioManager`

Both paths produce identical output shapes -- the same `createSuccessOutput` format currently used by `executeBacktestPortfolio`.

### 5. Backend: Update executor registry

**Modify**: `coreza-backend/src/nodes/index.ts`
- Import and register `PortfolioExecutor`

**Modify**: `coreza-backend/src/nodes/executors/BacktestExecutor.ts`
- Keep `BacktestPortfolio` case as a backward-compatible alias that delegates to the new `PortfolioExecutor` (or remove if safe)
- Extract shared portfolio formatting helpers (e.g., `portfolioGetAll`, `portfolioGetPosition`, `formatPositionWithPnlPercent`) into a shared utility so both executors can use them

### 6. Backend: BrokerExecutor integration

**Modify**: `coreza-backend/src/nodes/executors/BrokerExecutor.ts`
- After a successful `place_order` on Binance, notify the `PortfolioManager` instance to trigger an incremental sync

## Files Summary

| File | Action | Description |
|---|---|---|
| `src/nodes/BacktestPortfolio.json` | Delete | Replaced by Portfolio.json |
| `src/nodes/Portfolio.json` | Create | Unified portfolio node definition |
| Supabase migration | Create | `live_fills`, `position_snapshots`, `cash_snapshots` tables |
| `coreza-backend/src/services/PortfolioManager.ts` | Create | In-memory portfolio engine for broker mode |
| `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` | Create | Unified executor routing backtest vs broker |
| `coreza-backend/src/nodes/index.ts` | Modify | Register PortfolioExecutor |
| `coreza-backend/src/nodes/executors/BacktestExecutor.ts` | Modify | Extract shared helpers, add backward compat alias |
| `coreza-backend/src/nodes/executors/BrokerExecutor.ts` | Modify | Notify PortfolioManager after place_order |

## Backward Compatibility

- Existing workflows using `BacktestPortfolio` will still work -- the `BacktestExecutor` keeps the case match and delegates to the shared logic
- The output shape is identical, so downstream nodes consuming portfolio data need no changes
- New workflows should use the unified `Portfolio` node

