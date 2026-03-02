

# Support Multiple Symbols in Portfolio Node (Broker Mode)

## Problem

Currently, `params.symbol` is treated as a single string everywhere in the broker mode executor. When users provide multiple symbols (e.g., "BTCUSDT,ETHUSDT") or when operations should work across all tracked symbols, the code only handles one symbol at a time. This affects:

1. **`ensureSymbolTracked`** -- only tracks one symbol per execution
2. **`brokerGetPosition`** -- only returns one position
3. **`brokerGetPendingOrders`** -- only queries one symbol
4. **`sync_trades`** -- only syncs one symbol

## Solution

### 1. Parse symbol(s) from params (`PortfolioExecutor.ts`)

Add a helper that parses `params.symbol` into an array, supporting comma-separated input:

```text
private parseSymbols(symbol?: string): string[] {
  if (!symbol) return [];
  return symbol.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
}
```

### 2. Update `executeBrokerMode` lazy tracking (lines 203-207)

Change from single-symbol tracking to multi-symbol:

```text
const symbols = this.parseSymbols(params.symbol);
for (const sym of symbols) {
  await pm.ensureSymbolTracked(baseUrl, headers, creds, sym, environment);
}
```

### 3. Update `brokerGetPosition` (lines 429-462)

- If multiple symbols provided, return an array of positions for all of them
- If single symbol, keep current behavior (returns one position object)
- If no symbol, return ALL tracked positions from the portfolio manager

### 4. Update `brokerGetPendingOrders` (lines 510-537)

- Binance `/api/v3/openOrders` already returns ALL open orders when no `symbol` param is passed
- If multiple symbols given, make one call per symbol or one call with no filter then filter client-side
- Current code already handles `symbol` being undefined (line 520: `if (symbol) rawParams.symbol = symbol`) -- so this mostly works already

### 5. Update `sync_trades` (lines 224-236)

- Accept multiple symbols, loop and sync each
- Remove the hard requirement for a single symbol -- allow syncing all tracked symbols if none specified

```text
case "sync_trades": {
  const syncSymbols = symbols.length > 0
    ? symbols
    : pm.getTrackedSymbols();
  let totalCount = 0;
  for (const sym of syncSymbols) {
    totalCount += await pm.syncSymbolTrades(baseUrl, headers, creds, sym, environment);
  }
  return toNodeResult(createSuccessOutput({
    synced_trades: totalCount,
    symbols: syncSymbols,
    message: `Synced ${totalCount} new trades for ${syncSymbols.length} symbol(s)`,
  }));
}
```

### 6. Update `Portfolio.json` symbol field (line 91)

Change placeholder to indicate multiple symbols are supported:

```text
"placeholder": "e.g. BTCUSDT or BTCUSDT,ETHUSDT"
```

Also make `symbol` optional for `get_pending_orders` (already optional in Binance API) and `sync_trades` (can sync all tracked). Update `displayOptions` to show the symbol field for `get_pending_orders` too (currently hidden in broker mode since `get_pending_orders` is backtest-only in `operationDisplayOptions` -- this needs fixing separately).

## Files Changed

| File | Change |
|---|---|
| `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` | Add `parseSymbols()` helper. Update lazy tracking loop, `brokerGetPosition`, `sync_trades` to handle multiple symbols. |
| `src/nodes/Portfolio.json` | Update symbol placeholder. Make symbol not required for `sync_trades`. |

## Behavior Summary

| Operation | No symbol | Single symbol | Multiple symbols |
|---|---|---|---|
| `get_portfolio` | All positions (unchanged) | All positions (unchanged) | All positions (unchanged) |
| `get_position` | Error | Returns 1 position | Returns array of positions |
| `get_pending_orders` | All open orders | Orders for that symbol | Orders for those symbols |
| `sync_trades` | Sync all tracked symbols | Sync that symbol | Sync those symbols |
| `get_cash` | Unchanged | Unchanged | Unchanged |
| `get_equity` | Unchanged | Unchanged | Unchanged |
| `get_trades` | Unchanged | Unchanged | Unchanged |

