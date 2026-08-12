# Cross-Symbol Liquidation and Symbol-Scoped Backtest Pricing (Revision 2)

Updated to match the LEAN source-verified design note. The core rule is unchanged: **every simulated fill, validation, reservation, and price estimate must resolve market data from `order.symbol`** — never from whichever symbol's bar the workflow happened to be processing.

Revision 2 adds five things the earlier plan did not have: a single `resolveMarketContext(order)` boundary, `latestRealBar` kept separate from fill-forward event data, a pure eligibility classifier with atomic transitions, order-type-specific staleness rules instead of one global policy, and LEAN's signed pending-market-quantity arithmetic for liquidation.

## Confirmed current-state defect (verified in code)

- `SimBroker.setCurrentBar(bar)` writes `this.state.currentBar` with no symbol identity (`simBroker/index.ts:342`).
- `BacktestExecutor` BacktestTrade path calls `simBroker.setCurrentBar(currentBar)` with the *triggering* node's `current_bar`, then `simBroker.tryFillImmediateOrder(orderResult.orderId, currentBar)` (`BacktestExecutor.ts:778, 803`). An OTLK order raised during an AAPL event is filled at the AAPL close.
- `tryFillImmediateOrder(orderId, bar)` passes the caller's bar into `fillModel.fill()`, `slippageModel.getSlippage()`, `applyFill(..., bar.timestamp)` (`index.ts:499-560`) with no `bar.symbol` check.
- `estimateOrderPrice` falls back to `this.state.currentBar?.close` (`index.ts:869`), so validation and buying-power reservation can also be priced off the wrong symbol.
- `alignMultiSymbolBars` fill-forwards with `{ ...previousBar, time: timestamp }` (`BacktestExecutor.ts:672`), erasing the true observation time.
- `symbolStates` holds only `{ previousBar, lastFillPrice }` — no `latestRealBar`, no freshness metadata.
- No liquidation API exists on SimBroker or in `BacktestTrade.json`.

## Phase 1 — Regression tests first (freeze current behaviour)

`coreza-backend/tests/simBrokerCrossSymbolPricing.test.ts` — written before any refactor, expected to fail:

- AAPL close 220 / OTLK close 1.40; feed both, then submit an OTLK market sell while "processing" AAPL -> fill derives from 1.40, never 220.
- Only AAPL cached; submit an OTLK market order -> rejected `NO_MARKET_DATA`, never filled.
- Global fallback removal: unrelated current bar set, OTLK state empty -> `estimateOrderPrice` returns no price.
- Next-bar routing: OTLK order submitted, advance AAPL -> no fill; advance OTLK -> fills.
- Cross-symbol buy and sell with non-zero slippage and commission -> both models receive the order-symbol context.
- Buying-power reservation for market, limit, stop, short-cover, and explicitly priced resting orders (no regression in existing buying-power tests).

## Phase 2 — Canonical symbol context

### 2.1 `coreza-backend/src/backtest/simBroker/interfaces.ts`

```ts
export interface MarketBarEnvelope {
  symbol: string;
  bar: Bar;
  sourceTimestamp: number;   // when the bar actually occurred
  eventTimestamp: number;    // aligned backtest clock
  isFillForward: boolean;
  intervalMs?: number;
}

export interface RealObservation { bar: Bar; sourceTimestamp: number; }

export interface SymbolMarketState {
  latestRealBar: RealObservation | null;
  previousRealBar: RealObservation | null;
  latestEventTimestamp?: number;
  lastFillPrice?: number;
  lastEnvelopeWasFillForward: boolean;
}

export interface MarketDataPolicy {
  maxMarketOrderAgeMs: number;              // 0 = no limit
  maxConditionalOrderAgeMs: number;         // 0 = no limit
  allowFillForwardMarketOrders: boolean;    // default true
  requireRealBarForConditionalOrders: boolean; // default false
  rejectOnSymbolMismatch: true;
}
```

- `SimBrokerConfig` gains `marketDataPolicy: MarketDataPolicy` with defaults that preserve today's behaviour (both age limits `0`, fill-forward market orders allowed).
- Add `RejectionReason = "NO_MARKET_DATA" | "STALE_MARKET_DATA" | "MARKET_CLOSED" | "SYMBOL_MISMATCH"`.
- `Order` gains `submittedAt: number` and `submittedSequence: number`.
- `OrderEvent` gains provenance: `marketDataSymbol`, `marketDataSourceTimestamp`, `marketDataEventTimestamp`, `marketDataAgeMs`, `usedFillForwardData`, `fillModel`, `referencePrice`, `rejectionReason`.
- Mark `PortfolioState.currentBar` `@deprecated` (removed in Phase 6).

### 2.2 `simBroker/index.ts` — one market boundary

```ts
resolveMarketContext(order): ResolvedMarketContext | Failure
classifyMarketData(order, context): MarketDataEligibility   // pure, no mutation
applyEligibilityTransition(ticket, eligibility)             // atomic: status + reason
                                                            // + pending-index removal
                                                            // + reservation release + OrderEvent
```

- `resolveMarketContext` is the **only** place market data enters validation, reservation, fills, slippage and fees. It returns the order-symbol state, age (`eventTimestamp - sourceTimestamp`) and fill-forward flag.
- `classifyMarketData` is pure. It applies order-type-specific rules from `MarketDataPolicy`: market orders use `maxMarketOrderAgeMs` and `allowFillForwardMarketOrders`; limit/stop use `maxConditionalOrderAgeMs` and `requireRealBarForConditionalOrders`. No single universal allow/pend/reject rule.
- `onBar(envelope: MarketBarEnvelope)` is the canonical form:
  - validate the envelope (finite timestamps, `sourceTimestamp <= eventTimestamp`, monotonic `eventTimestamp` per symbol),
  - **only when `!isFillForward`**: shift `previousRealBar = latestRealBar`, set `latestRealBar = { bar, sourceTimestamp }`. Fill-forward events update `latestEventTimestamp` only — they never replace the last real observation (matches LEAN `SecurityCache`),
  - scan pending tickets for that symbol only, passing the current real bar and the captured prior real bar per the selected fill model,
  - stop writing `this.state.currentBar`.
- Legacy adapter `onBar(symbol, bar, meta?)` normalizes to an envelope, asserts every available symbol identity matches (throw in tests, telemetry counter in prod), and is deleted in Phase 6.
- `tryFillImmediateOrder(orderId)` — no bar parameter:

```ts
const ticket = this.state.tickets[orderId];
if (!ticket || !isTicketPending(ticket)) return null;
const context = this.resolveMarketContext(ticket.order);
const eligibility = this.classifyMarketData(ticket.order, context);
if (!eligibility.eligible) return this.applyEligibilityTransition(ticket, eligibility);
return this.fillTicket(ticket, context);
```

- `estimateOrderPrice(order)`: `explicitRestingOrderPrice(order) ?? market?.latestRealBar?.bar.close ?? 0`. No `state.currentBar`, no cross-symbol `lastFillPrice`, and never `position.currentPrice` / `avgFillPrice`.
- **No-market-data contract:** an unpriced market order is rejected before reservation with `NO_MARKET_DATA`; an explicitly priced limit/stop order is accepted and stays pending until its symbol produces eligible data.
- **Order-time causality:** conditional and next-bar orders may only fill from a bar with `sourceTimestamp > order.submittedAt`, unless `sameBarPolicy === "allow-close"`.

### 2.3 `BacktestExecutor.ts` (BacktestTrade path)

- Remove `simBroker.setCurrentBar(currentBar)`.
- Call `simBroker.tryFillImmediateOrder(orderResult.orderId)` with no bar, and no longer gate it on `currentBar` being present.
- Keep parsing `current_bar` for node output/back-compat only; add a dev-mode assertion when its symbol differs from `order.symbol`.
- Node result reports `symbol`, `fill_price`, `market_data_symbol`, `market_data_age_ms`, `used_fill_forward_data`.

## Phase 3 — Fill-forward provenance

- `alignMultiSymbolBars` emits envelopes rather than mutated bars: real bars get `sourceTimestamp = bar.time, isFillForward: false`; copied bars get `bar: { ...previous.bar, timestamp }, sourceTimestamp: previous.sourceTimestamp ?? previous.bar.time, isFillForward: true`. Repeated fill-forward events keep the **original** source timestamp — it must not creep forward.
- `MultiBarEvent` gains optional `fillForwardSymbols: string[]`.
- `BacktestSession.ts` (three `onBar` sites at ~440, ~509, ~626) and `PortfolioExecutor.ts:312` build and pass `MarketBarEnvelope`. Sites without metadata fall back to `sourceTimestamp = bar.time, isFillForward: false`, so behaviour is unchanged.
- Every fill — including each partial fill — snapshots its own provenance onto the `OrderEvent` and the persisted trade record.

## Phase 4 — Liquidation API (LEAN arithmetic)

```ts
liquidate(symbol: string, options?: { orderType?: OrderType; limitPrice?: number; tag?: string }): OrderResult
```

Executed under a per-symbol order lock so concurrent calls cannot share a stale snapshot:

1. Read `holdingQty = positions[symbol]?.quantity ?? 0` and the open tickets for the symbol.
2. If an exact pending market close already covers the holding -> `{ success: true, status: "already_pending" }`.
3. Cancel every **non-market** open order for the symbol.
4. `pendingMarketQty` = sum of **signed** `quantityRemaining` across *all* pending market orders — including same-side and reversing ones, not only position-reducing ones (this corrects the earlier draft).
5. Submit `-(holdingQty + pendingMarketQty)` through the normal `placeOrder` path; if the result is 0, nothing is submitted.
6. Under the immediate model, call `tryFillImmediateOrder(orderId)`, which resolves the *liquidated* symbol's market state.
7. Never mutate the position directly; never use `averagePrice` as a fill price. Success means "order accepted or already pending", not "position flat".
8. With shorting disabled, liquidation can never push a long position below zero.

### Node surface

- `src/nodes/BacktestTrade.json`: add an `operation` select (`place_order` default, `liquidate`); when `liquidate` is selected show `symbol`, `order_type`, `tag` and hide `side` / `quantity` / prices via `displayOptions`.
- `BacktestExecutor`'s BacktestTrade handler branches on `operation === "liquidate"` and returns the same result shape (`order_id`, `fill_price`, `fill_quantity`, `cash`, `positions`, `total_equity`).

### Tests — `coreza-backend/tests/simBrokerLiquidation.test.ts`

- Long 500 -> sell 500; short -500 -> buy 500.
- Cross-symbol: liquidate OTLK during an AAPL event -> fill at the OTLK price.
- Duplicate liquidation before fill -> second coalesced/rejected, no over-close.
- Pending market orders that are same-side, reducing, and reversing -> signed remainder arithmetic produces a flat projected position.
- Non-market pending orders are cancelled first.
- Partial fill -> remaining quantity is used for later liquidation arithmetic.
- No position -> `NO_POSITION`, no order created.

## Phase 5 — Staleness and eligibility tests

- Two and three consecutive fill-forward events preserve the same `sourceTimestamp` and do not replace `latestRealBar`.
- Exact stale boundary at minute, hourly, and mixed resolutions; market and conditional policies asserted separately.
- A limit or stop order never evaluates against a source bar completed before submission.
- Pending orders wake only on eligible data for their own symbol.
- Reject transition is atomic: terminal status + reason, pending-index removal, reservation release, `OrderEvent` emission.
- A stale-price rejection leaves cash and position unchanged; changing AAPL prices alone never changes an OTLK fill.

## Phase 6 — Cleanup

Only once the legacy-adapter telemetry counter reaches zero: delete `setCurrentBar`, the `onBar(symbol, bar)` adapter, the `tryFillImmediateOrder(orderId, bar)` overload, and `PortfolioState.currentBar`.

## PR scope

First PR = Phases 1-2 plus 2.3 (symbol-scoped state, immediate-fill signature, global fallback removal, tests). Phases 3-6 follow so review stays manageable.

## Out of scope

- Quote/bid-ask-aware fill models (a later direction-aware model can use bid for sell / ask for buy).
- Any change to live/broker pricing — broker-reported `avgFillPrice` stays authoritative.
- Signal generation, indicators, or using a user RollingWindow as execution authority.

## Definition of done

The price used for an order is a function of the order symbol's eligible market data and the configured reality models — never a function of whichever workflow symbol happened to be executing — and `SimBroker` exposes no API that accepts a caller-selected bar as pricing input.
