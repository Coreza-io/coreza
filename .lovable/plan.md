

# End-to-End Review: Fill Deduplication & Ownership Verification

## Verdict: Implementation is architecturally sound with 4 minor issues to fix

The three-layer defense (ownership verification → partial fill delta → dedup) is the right pattern for a trading system. The Redis reverse index approach is efficient and well-suited. Here are the findings:

---

## Issue 1: Ownership cache never evicts — unbounded memory growth

`PortfolioExecutor.ownershipCache` is a static `Map` that grows forever. In a long-running process handling thousands of orders over days/weeks, this leaks memory.

**Fix**: Add a periodic sweep or cap the Map size. Simplest approach — sweep expired entries every 1000 lookups:

```typescript
private static ownershipLookupCount = 0;

private async checkOwnership(id: string): Promise<boolean> {
  // Sweep every 1000 lookups
  if (++PortfolioExecutor.ownershipLookupCount % 1000 === 0) {
    const now = Date.now();
    for (const [key, val] of PortfolioExecutor.ownershipCache) {
      if (val.expiry < now) PortfolioExecutor.ownershipCache.delete(key);
    }
  }
  // ... rest unchanged
}
```

**Impact**: Prevents OOM in long-running production processes.

---

## Issue 2: Manual fill dedup is broken — every call generates a new ID

In `applyFill()` line 476, the `else` branch (no fillId) increments `tradeIdCounter` to create a `manualId`, then checks `fillIdSet`. Since the ID is unique every time, the dedup check **always passes** — it can never detect a duplicate.

This is harmless in practice (manual fills without a `fillId` have no natural dedup key), but the code is misleading. The `fillIdSet` check in the else branch should be removed — it gives a false sense of dedup.

**Fix**: Remove the dead dedup check for manual fills:

```typescript
} else {
  // Manual fills have no dedup key — always apply
}
const tradeId = fillId ? `${fillId}-${absQty}` : `MANUAL-${++this.tradeIdCounter}`;
```

**Impact**: Code clarity only. No behavioral change.

---

## Issue 3: Commission proration formula is wrong for partial fills

Line 495: `commission * (effectiveQty / absQty)` — here `absQty` is the **cumulative** filled quantity from the event, not the total order quantity. So on the first partial fill (say 30 of 100 shares), `effectiveQty = 30`, `absQty = 30`, proration = 100%. On the second event (cum 60), `effectiveQty = 30`, `absQty = 60`, proration = 50%.

The problem: Alpaca reports commission **per event**, not cumulative. So the first event's commission applies to 30 shares and should be used as-is. The second event's commission also applies to its own fill and should be used as-is. The proration formula incorrectly halves the second event's commission.

**Fix**: Use the commission directly without proration when using delta tracking:

```typescript
commission: commission, // Commission from the event applies to this fill event's delta
```

If a broker sends cumulative commission instead, you'd need `eventCommission - previousCumCommission` (a commission delta map). But Alpaca sends per-event commission, so direct pass-through is correct.

**Impact**: Incorrect commission accounting in partial fill scenarios. Real money impact.

---

## Issue 4: `quantity` field semantics are ambiguous for partial fills

The `quantity` field in Portfolio.json says "Filled quantity (absolute value)" but for partial fills with delta tracking, the user must pass **cumulative** `filledQty` (not the incremental fill). The delta is computed internally. This is not documented and will confuse users.

**Fix**: Update the field description:

```json
"description": "Cumulative filled quantity when using Fill ID (delta computed automatically). Absolute value — side controls direction."
```

**Impact**: User confusion and incorrect accounting if they pass incremental qty instead of cumulative.

---

## Summary

| Issue | Severity | Type |
|---|---|---|
| Ownership cache unbounded growth | Medium | Memory leak |
| Manual fill dedup is dead code | Low | Code clarity |
| Commission proration wrong for partial fills | High | Accounting bug |
| Quantity field semantics undocumented | Medium | UX/correctness |

The architecture itself — Redis reverse index for ownership, in-memory delta tracking for partials, local cache for performance — is the right approach. These are implementation-level fixes, not architectural changes.

