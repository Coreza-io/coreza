

# Refactor PortfolioManager: Pure In-Memory, No Database Persistence

## Problem

The current `PortfolioManager` treats fills as persistent data -- it writes every fill to a `live_fills` Supabase table and reads them back on bootstrap. This is wrong for the intended architecture. Following QuantConnect's model:

- All portfolio state (orders, fills, holdings, PnL) lives **in RAM only**, scoped to the algorithm/workflow run.
- When the workflow stops, memory is gone.
- On the next workflow run, portfolio is re-initialized fresh from the broker API (account balances + recent trades).

The `live_fills`, `position_snapshots`, and `cash_snapshots` tables become unnecessary overhead.

## Changes

### 1. Remove all Supabase persistence from `PortfolioManager.ts`

**Remove these methods entirely:**
- `loadPersistedFills()` -- no longer loading from DB
- `persistFill()` -- no longer writing fills to DB
- `snapshotToDb()` -- no longer snapshotting to DB

**Remove the Supabase import:**
- `import { supabase } from "../config/supabase";`

**Update `bootstrap()`:**
- Remove step 1 (`await this.loadPersistedFills()`)
- Bootstrap now only does: (a) fetch cash balances from broker API, (b) fetch recent trades from broker API for each symbol, (c) replay fills in-memory

**Update `syncSymbolTrades()`:**
- Remove the `this.persistFill(fill)` fire-and-forget call at line 343-345
- Fills are only stored in-memory (`fillLedger`, `fillIdSet`, `holdings`)

### 2. Change static instance lifecycle

Currently `PortfolioManager.instances` is a global static `Map` that persists across workflow runs. This means stale state leaks between runs.

**Add a `destroy()` method** that clears all in-memory state and removes the instance from the static cache. The `PortfolioExecutor` (or the workflow engine cleanup hook) should call this when a workflow run ends.

**Add `static destroyAll()`** for batch cleanup on process shutdown.

### 3. Update `PortfolioExecutor.ts` broker mode

- Remove any references to `snapshotToDb`
- The executor already doesn't call `snapshotToDb` directly, so no change needed there
- Ensure `sync_trades` operation still works (it will -- it just won't persist to DB anymore)

### 4. Consider removing DB tables

The following Supabase tables are no longer needed by `PortfolioManager`:
- `live_fills` -- was the fill persistence layer, now replaced by pure in-memory
- `position_snapshots` -- was periodic DB snapshots
- `cash_snapshots` -- was periodic DB snapshots

However, these tables may still be useful for **audit/reporting purposes** (e.g., a separate analytics job that snapshots portfolio state periodically for the user dashboard). So the recommendation is:

- **Do NOT delete the tables yet** -- they may serve a reporting/dashboard purpose later
- **Remove all references from PortfolioManager** -- the manager itself should be pure in-memory
- If snapshot/audit logging is needed later, it should be a separate service that reads from the PortfolioManager, not baked into it

## Technical Summary

| File | Action |
|---|---|
| `coreza-backend/src/services/PortfolioManager.ts` | Remove `supabase` import, delete `loadPersistedFills()`, `persistFill()`, `snapshotToDb()`. Update `bootstrap()` to skip DB load. Remove persist call from `syncSymbolTrades()`. Add `destroy()` and `static destroyAll()`. |
| `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` | No changes needed (doesn't call persistence methods directly) |
| Supabase tables (`live_fills`, `position_snapshots`, `cash_snapshots`) | Keep for now, but no longer written to by PortfolioManager |

## Lifecycle per workflow run

```text
Workflow Start
  --> PortfolioExecutor.executeBrokerMode()
      --> PortfolioManager.getInstance() (creates fresh instance)
      --> pm.bootstrap()
          --> fetchCashBalances() via broker API
          --> syncSymbolTrades() via broker API (fills replayed in-memory)
      --> pm.getPortfolioState() / getPosition() / etc.

Workflow End
  --> PortfolioManager.removeInstance() or pm.destroy()
      --> All in-memory state (fills, holdings, trades, cash) is garbage collected
```

