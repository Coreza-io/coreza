# Close the Gaps: Liquidation Completeness + Same-Bar Causality + Envelope Hardening

Follow-up to the implemented cross-symbol pricing work. Scope is `coreza-backend/src/backtest/simBroker/index.ts`, `coreza-backend/src/backtest/BacktestExecutor.ts`, and `coreza-backend/src/backtest/simBroker/interfaces.ts`. No frontend change except one optional node-output addition.

## Phase A — Liquidation completeness (behavioural)

### A1. Cancel resting non-market orders before liquidating

In `SimBroker.liquidate(symbol, tag)`, before computing `pendingMarketQty`:

- Iterate `pendingTicketsBySymbol.get(symbol)`; for every pending ticket whose `normalizeOrderType(order.orderType) !== "market"` (i.e. limit / stop_market / stop_limit / MOO / MOC treated per type), call the existing `cancelOrder(id)`.
- Collect the cancelled ids into `canceledOrderIds: string[]` and return them on the result so the node can report them.
- `cancelOrder` already routes through `transitionPendingOrder`, which releases the reservation and removes the pending index entry — no new teardown code needed.
- Only market orders remain pending afterwards, so the existing signed-remainder loop is unchanged.

Rationale: a resting limit/stop left alive can re-open the position immediately after liquidation.

### A2. Attempt an immediate fill inside `liquidate`

- After `placeOrder` succeeds and `this.config.fillModel === "immediate"`, call `this.tryFillImmediateOrder(orderId)` and include the resulting `OrderEvent | null` on the return value as `fill`.
- Change the return type to a single discriminated shape:

```ts
type LiquidationResult =
  | { success: true; skipped: true; reason: "NOTHING_TO_LIQUIDATE" | "LIQUIDATION_IN_FLIGHT"; canceledOrderIds: string[] }
  | { success: true; skipped?: false; orderId: string; status: string; canceledOrderIds: string[]; fill: OrderEvent | null }
  | { success: false; error: string; canceledOrderIds: string[] };
```

- Keep "success means accepted or already pending", never "position is flat".

### A3. Make the liquidation lock meaningful (or drop it)

`liquidationLocks` is added and deleted inside one synchronous call, so it can never be observed. Hold it across the whole sequence instead:

- Acquire before the cancel sweep; release in a `finally` that wraps cancels + arithmetic + `placeOrder` + immediate fill.
- Keep the early `LIQUIDATION_IN_FLIGHT` return for reentrancy (a fill callback that liquidates again).
- Duplicate protection for sequential calls continues to come from the signed arithmetic (`target === 0` -> `NOTHING_TO_LIQUIDATE`).

### A4. Wire the executor branch

`BacktestExecutor.ts` liquidate branch (~:774):

- Return `canceled_order_ids`, `order_id`, `order_status`, `fill_price`, `fill_quantity`, `commission`, `slippage` from `result.fill`, alongside the existing `cash` / `positions` / `pending_orders` / `total_equity`.
- Keep the `skipped` / `reason` passthrough.

## Phase B — Same-bar causality and `sameBarPolicy`

### B1. Enforce the configured policy

`sameBarPolicy: "strict" | "allow-close"` exists in `SimBrokerConfig` but is never read. Add a private helper:

```ts
private isCausallyEligible(order: Order, context: ResolvedMarketContext): boolean
```

Rules:

- Market orders: unchanged — eligible as soon as the symbol has data (the immediate-fill path is the intended same-bar behaviour).
- Conditional (`limit`, `stop_market`, `stop_limit`) and all orders under `fillModel === "next_bar_open"`: require `context.sourceTimestamp !== undefined && context.sourceTimestamp > order.submittedAt`.
- When `sameBarPolicy === "allow-close"`, relax to `>=` so a bar whose source timestamp equals the submission clock may fill.

### B2. Replace the ad-hoc guard in `onBar`

Remove the inline `envelope.eventTimestamp < order.submittedAt` check (`index.ts:466-471`) and call `isCausallyEligible(order, context)`; when false, `continue` (leave pending, never reject). Apply the same check in `tryFillImmediateOrder` before `fillTicket`, so both entry points share one rule.

Note: `submittedAt` is seeded from `latestEventTimestamp` at placement, so an order placed during bar N will not fill on bar N's replay under `strict`.

## Phase C — Envelope validation and legacy adapter hardening

### C1. Validate every envelope in `onBar`

Add `private validateEnvelope(envelope): string | null` checked at the top of `onBar`:

- `symbol` non-empty; `bar` present with finite `open/high/low/close`.
- `sourceTimestamp` and `eventTimestamp` finite and > 0.
- `sourceTimestamp <= eventTimestamp`.
- `eventTimestamp >= marketState.latestEventTimestamp` (monotonic per symbol).

On failure: throw when `process.env.NODE_ENV === "test"`, otherwise `console.warn` once per symbol+reason and return `[]` without mutating state (an invalid envelope must never corrupt `latestRealBar`).

### C2. Assert symbol identity in the legacy adapter

In the positional `onBar(symbol, bar)` branch, if the raw bar carries a symbol-ish field (`bar.symbol` / `(bar as any).Symbol`) that differs from the passed `symbol`, throw in test env and increment a `legacySymbolMismatches` counter + warn in prod. Expose the counter from the existing `getLegacyCallCounters()` accessor.

### C3. Consistent fill bar

`onBar` currently passes the envelope bar into `fillTicket` as `overrideBar`; on a fill-forward event that bar is a copy stamped with the event clock while `context.bar` is the true observation.

- Drop the `overrideBar` / `overridePreviousBar` parameters from `fillTicket` and always use `context.bar` / `context.previousBar`.
- `context.bar` is set from `latestRealBar` which `onBar` has just updated for real observations, so non-fill-forward behaviour is byte-identical; only fill-forward fills change — they now price and timestamp off the real observation, which is what `usedFillForwardData` + `marketDataAgeMs` already advertise.
- Mark-to-market at the end of `onBar` keeps using the envelope bar's close (the fill-forward close equals the last real close anyway).

## Phase D — Observability

### D1. Provenance on the node result

In the BacktestTrade place-order result, add from `fill`: `market_data_symbol`, `market_data_age_ms`, `used_fill_forward_data`, `reference_price`, and `rejection_reason` when the event is a rejection. Same fields on the liquidate result.

### D2. `fillForwardSymbols` on the multi-bar event

Add optional `fillForwardSymbols?: string[]` to the multi-bar event type produced by `alignMultiSymbolBars` and populate it with the symbols that were copied forward for that timestamp. Debug-only; nothing consumes it yet.

## Technical notes

- No changes to `interfaces.ts` beyond the new `LiquidationResult` type export and the optional `fillForwardSymbols` field.
- No signature change for `placeOrder`, `resolveMarketContext`, `classifyMarketData`, or `applyEligibilityTransition`.
- Phase 6 cleanup (deleting `setCurrentBar`, the legacy `onBar` overload, and `PortfolioState.currentBar`) stays deferred until the legacy counters read zero in your environment.
- Tests remain out of scope per your earlier direction; the test-env `throw`s in C1/C2 are still added since they cost nothing and fail loudly if tests are added later.

## Definition of done

Liquidation cancels resting orders, fills immediately under the immediate model, and reports what it cancelled and filled; conditional/next-bar orders honour `sameBarPolicy` through a single shared causality check; malformed or out-of-order envelopes cannot corrupt symbol state; and every fill or rejection surfaced to the workflow carries its market-data provenance.
