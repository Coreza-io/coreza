

# Review: Unified Portfolio Implementation -- Issues and Optimization Recommendations

## Overall Assessment

The implementation is **structurally sound** -- the architecture (unified node, mode-based routing, shared SimBroker cache, static PortfolioManager instances) follows the existing config-driven patterns well. However, there are several **critical bugs**, **code duplication**, and **optimization gaps** that should be addressed.

---

## Critical Issues

### 1. PortfolioManager calls Binance SIGNED endpoints without signing

**Severity: BLOCKER -- will fail at runtime**

`PortfolioManager.fetchCashBalances()` calls `/api/v3/account` and `syncSymbolTrades()` calls `/api/v3/myTrades` using raw `axios.get()` with only headers. These are **SIGNED** endpoints requiring `timestamp`, `recvWindow`, and `signature` query parameters (HMAC-SHA256).

The existing `BrokerExecutor` path uses `signHmacSha256()` via `operations.ts` `makeParams()`, but `PortfolioManager` bypasses this entirely. Every call will return Binance error `-2014` or `-1022`.

**Fix**: Import and use `signHmacSha256` and `getBinanceTimestamp` from existing utils. The `bootstrap()` and `syncSymbolTrades()` methods need `creds` (with `secret_key`) passed in, not just `headers`.

### 2. Supabase 1000-row default limit on `loadPersistedFills()`

The query at line 150-156 fetches fills without a `.limit()` override. Supabase caps at 1000 rows by default. Users with more than 1000 historical fills will silently lose data, causing incorrect cost basis calculations.

**Fix**: Add pagination or set an explicit higher limit (e.g., `.limit(10000)`) with a loop for accounts with very large fill histories.

### 3. No `get_pending_orders` support in broker mode

`Portfolio.json` includes `get_pending_orders` as an operation, but the broker-mode switch statement in `PortfolioExecutor` (lines 200-228) has no case for it. It falls to the default error handler.

**Fix**: Either implement it by calling Binance `/api/v3/openOrders` via the existing `BrokerExecutor` operations, or remove it from the node JSON's operation list when in broker mode (via `displayOptions`).

---

## Code Duplication

### 4. BacktestExecutor and PortfolioExecutor have duplicated portfolio logic

`BacktestExecutor.executeBacktestPortfolio()` (line 870) and `PortfolioExecutor.executeBacktestMode()` (line 79) contain **identical logic** -- parameter resolution, MTM application, operation switch. Similarly, the helper methods (`portfolioGetAll`, `portfolioGetPosition`, etc.) are duplicated between both files.

The `BacktestExecutor` still routes `"BacktestPortfolio"` and `"Portfolio"` node types to its own internal methods, while `PortfolioExecutor` has its own copies.

**Fix**: Remove the duplicated helpers from `BacktestExecutor` and have the `"BacktestPortfolio"` / `"Portfolio"` cases delegate to `PortfolioExecutor` directly, or extract helpers to a shared utility module.

### 5. `parseBar()` and `parsePrices()` duplicated

Both `PortfolioExecutor` and `BacktestExecutor` have identical `parseBar()` and `parsePrices()` methods.

**Fix**: Move to a shared utility (e.g., `coreza-backend/src/utils/barParser.ts`).

---

## Design / Optimization Issues

### 6. `fillLedger` linear scan for deduplication is O(n) per fill

Line 259: `this.fillLedger.some((f) => f.symbol === symbol && f.tradeId === tradeId)` scans the entire ledger for every incoming fill. With thousands of fills, this becomes expensive.

**Fix**: Use a `Set<string>` keyed by `${symbol}:${tradeId}` for O(1) dedup lookups.

### 7. Bootstrap only tracks symbols passed at first call

`PortfolioExecutor.executeBrokerMode()` bootstraps with `params.symbol ? [params.symbol] : []`. If the first call is `get_portfolio` (no symbol), bootstrap runs with zero symbols -- meaning no fills are loaded and no cost basis is reconstructed.

**Fix**: Either require symbols at bootstrap, or store a "tracked symbols" set that grows over time, syncing new symbols on first access.

### 8. `fetchCashBalances` doesn't use signing (reiteration of issue 1)

The `baseUrl + headers` pattern throughout PortfolioManager assumes the headers alone are sufficient for auth. The Binance broker config's `makeAuthHeaders()` returns `{ 'X-MBX-APIKEY': apiKey }` but the signed params must be in the query string.

### 9. No error result checking on `persistFill` and `snapshotToDb`

The Supabase `upsert` and `insert` calls don't check `error` from the response. Silent failures will go unnoticed.

**Fix**: Check `{ error }` and log appropriately.

### 10. `peakEquity` always equals `totalEquity` in broker mode

Line 479: `peakEquity: cashUsdt + positionsValue` -- this is always set to current equity, never tracking the actual peak. This makes drawdown calculations impossible.

**Fix**: Add a `peakEquity` field that updates on each state change via `Math.max(this.peakEquity, currentEquity)`.

---

## Minor Issues

### 11. Node JSON: `sync_trades` and `update_mtm` missing `displayOptions` for mode

`sync_trades` should only appear when `mode = broker`, and `update_mtm` only when `mode = backtest`. Currently both are always visible regardless of mode.

### 12. `formatPositionWithPnlPercent` overwrites `unrealizedPnl` with percentage

The helper replaces the numeric PnL value with a percentage, which is confusing. It stores the original in `unrealizedPnlValue` but the original field name now holds a percentage. Downstream consumers expecting a dollar value will get a percentage.

---

## Recommended Fix Plan

| Priority | Issue | Effort |
|---|---|---|
| P0 | 1. Add Binance request signing to PortfolioManager | Medium -- refactor to accept `creds` and use `signHmacSha256` |
| P0 | 2. Fix Supabase 1000-row limit on fill loading | Small -- add pagination |
| P0 | 3. Add `get_pending_orders` for broker mode or hide it | Small |
| P1 | 4-5. Extract shared helpers, remove duplication | Medium |
| P1 | 6. Use Set for fill dedup instead of linear scan | Small |
| P1 | 7. Fix bootstrap symbol tracking | Small |
| P2 | 9. Add error checking on persistence calls | Small |
| P2 | 10. Track peak equity properly | Small |
| P2 | 11. Add mode-specific displayOptions to node JSON | Small |
| P2 | 12. Fix PnL format confusion | Small |

