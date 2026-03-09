

# Review: Portfolio Implementation — Broker Genericity

## Verdict: 95% generic. One critical bug prevents correct cash tracking for non-crypto brokers.

## What's Already Generic (Working Well)

- **PortfolioManager** is a pure in-memory accounting engine — no broker API calls, no broker imports
- **PortfolioExecutor** receives all data through explicit fields (symbol, side, quantity, price, commission, fill_id) — fully broker-agnostic input contract
- **Ownership verification** uses Redis-based idempotency keys — works for any broker
- **Partial fill delta tracking** via `orderCumQtyMap` — works for Binance cumulative qty and Alpaca cumulative qty identically
- **Pending order ledger** — pure data structure, no broker assumptions
- **Position accounting** (weighted avg cost basis, position flips, realized PnL) — mathematically generic

## Bug: Cash Adjustment Hardcodes "USDT" Fallback

In `PortfolioManager.ts` line 380:
```typescript
const quoteAsset = this.extractQuoteAsset(fill.symbol) ?? "USDT";  // ← hardcoded!
```

For stock symbols like "AAPL", `extractQuoteAsset()` returns `null` (no USDT/USDC suffix), so cash is adjusted against "USDT" instead of the actual base currency (e.g., "USD"). This means buying AAPL deducts from a "USDT" cash bucket that doesn't exist for Alpaca users.

**Root cause**: `adjustCashBookForFill()` doesn't receive `baseCurrency`. The `applyFill()` method has `baseCurrency` but only passes it for `commissionAsset` (line 613), not for the cash adjustment.

**Additionally**, `extractBaseAsset("AAPL")` returns `null`, so no base asset balance is tracked for stock positions — this is actually correct for stocks (you don't hold "AAPL tokens" in a cash book, only shares in holdings).

### Fix

| File | Change |
|---|---|
| `coreza-backend/src/services/PortfolioManager.ts` | Pass `baseCurrency` to `adjustCashBookForFill()`. Change the method signature to accept `baseCurrency` and use it as fallback instead of hardcoded `"USDT"`. Update `applyFillToHoldings()` to also accept and forward `baseCurrency`. |

Specifically:
1. `applyFillToHoldings(fill, adjustCash, baseCurrency)` — add `baseCurrency` param
2. `adjustCashBookForFill(fill, adjustCash, baseCurrency)` — add `baseCurrency` param
3. Line 380: `this.extractQuoteAsset(fill.symbol) ?? baseCurrency` instead of `?? "USDT"`
4. Update the 4 call sites within `applyFillToHoldings` to pass `baseCurrency`
5. Update `applyFill()` (line 623) to pass `baseCurrency`: `this.applyFillToHoldings(liveFill, true, baseCurrency)`

### Minor: Update comment

| File | Change |
|---|---|
| `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` | Line 37: Change "live Binance Spot data" → "live broker data" |

