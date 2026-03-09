

# End-to-End Review: Current Implementation State

## Overall Assessment: Architecture is solid, but the Pending Order Ledger is missing and there are 4 cleanup issues.

---

## Critical Finding: Pending Order Ledger Not Implemented

The approved plan to add `registerOrder()`, `cancelOrder()`, `getPendingOrders()`, and auto-decrement in `applyFill()` was discussed but **never added to the code**. `PortfolioManager.ts` has no `pendingOrders` Map, no `PendingOrder` interface, and no related methods. `PortfolioExecutor.ts` has no `register_order` / `cancel_order` / `get_pending_orders` operation handlers. `Portfolio.json` has no entries for these operations.

This is the main gap — without it, strategies have no way to know if an order is pending, leading to duplicate order submissions.

**Action**: Implement the full Pending Order Ledger as previously approved.

---

## Issue 1: `fillIdSet` is dead weight — grows unbounded, never checked

`fillIdSet` (line 77) is populated on every fill (line 493) but **never read for dedup**. The delta-based `orderCumQtyMap` handles fillId dedup, and manual fills always get unique IDs so the set can never catch a duplicate.

**Fix**: Remove `fillIdSet` entirely. It serves no purpose and leaks memory.

## Issue 2: `fillLedger` grows unbounded — never read or trimmed

`fillLedger` (line 76) receives a `.push()` on every fill (line 494) but is never queried, returned, or trimmed. For a strategy running days with thousands of fills, this is a pure memory leak.

**Fix**: Either expose it via a `getFills()` getter (useful for audit/debugging) and add an optional cap, or remove it. If kept, add a max size (e.g., last 10,000 fills) with FIFO eviction.

## Issue 3: `getPortfolioSummary()` called on every fill response — O(N) per fill

Every `update_portfolio` response (lines 279, 303, 322) calls `getPortfolioSummary()`, which calls `getPortfolioState()`, which iterates all holdings and trades to compute positions, equity, and PnL. For high-frequency strategies processing hundreds of fills per second, this adds unnecessary overhead.

**Fix**: Return a lightweight response from `update_portfolio` (just the fill result + equity) and let the user call `get_portfolio` separately when they need the full snapshot. Alternatively, cache the summary and invalidate on state change.

## Issue 4: `base_currency` not shown for `update_mtm` in broker mode

The `base_currency` field's `displayOptions` (Portfolio.json line 126-134) doesn't include `update_mtm`, so users can't select a base currency when using MTM updates. The code defaults to "USDT" but this is invisible to the user.

**Fix**: Add `"update_mtm"` to the `base_currency` field's display options.

---

## Summary

| Finding | Severity | Type |
|---|---|---|
| Pending Order Ledger not implemented | Critical | Missing feature |
| `fillIdSet` dead weight, unbounded growth | Medium | Memory leak |
| `fillLedger` unbounded, never read | Medium | Memory leak |
| `getPortfolioSummary()` on every fill | Low | Performance |
| `base_currency` missing from `update_mtm` | Low | UX |

## Recommended Implementation Order

1. Implement Pending Order Ledger (PendingOrder interface, registerOrder, cancelOrder, auto-decrement in applyFill, executor operations, Portfolio.json entries)
2. Remove `fillIdSet` (dead code)
3. Cap or remove `fillLedger` (memory leak)
4. Add `update_mtm` to `base_currency` display options (one-line fix)
5. Optionally slim down `update_portfolio` response (performance)

