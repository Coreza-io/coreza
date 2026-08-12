# Cross-Symbol Liquidation and Symbol-Scoped Backtest Pricing

Implements the attached design note. The core rule: **every simulated fill, validation, reservation, and price estimate must resolve market data from `order.symbol`** — never from whichever symbol's bar the workflow happened to be processing.

## Confirmed current-state defect (verified in code)

- `SimBroker.setCurrentBar(bar)` writes `this.state.currentBar` with no symbol identity (`simBroker/index.ts:342`).
- `BacktestExecutor` BacktestTrade path calls `simBroker.setCurrentBar(currentBar)` with the *triggering* node's `current_bar`, then `simBroker.tryFillImmediateOrder(orderResult.orderId, currentBar)` (`BacktestExecutor.ts:778, 803`). An OTLK order raised during an AAPL event is filled at the AAPL close.
- `tryFillImmediateOrder(orderId, bar)` passes the caller's bar straight into `fillModel.fill()`, `slippageModel.getSlippage()`, `applyFill(..., bar.timestamp)` (`index.ts:499-560`) with no `bar.symbol` check.
- `estimateOrderPrice` falls back to `this.state.currentBar?.close` (`index.ts:869`), so validation and buying-power reservation can also be priced off the wrong symbol.
- `alignMultiSymbolBars` fill-forwards with `{ ...previousBar, time: timestamp }` (`BacktestExecutor.ts:672`), erasing the true observation time — staleness is invisible.
- `symbolStates` currently holds only `{ previousBar, lastFillPrice }`; there is no `latestBar` and no freshness metadata.
- No liquidation API exists on SimBroker or in `BacktestTrade.json` / `Portfolio.json`.

## Phase 1 — Symbol-scoped market state (correctness core)

### 1.1 `coreza-backend/src/backtest/simBroker/interfaces.ts`
- Add:

```ts
export interface MarketBarEnvelope {
  symbol: string;
  bar: Bar;
  eventTimestamp: number;   // aligned backtest clock (epoch ms)
  sourceTimestamp: number;  // when the bar actually occurred
  isFillForward: boolean;
  barIndex?: number;
}

export interface SymbolMarketState {
  latestBar: Bar | null;
  previousBar: Bar | null;
  lastFillPrice?: number;
  sourceTimestamp?: number;
  eventTimestamp?: number;
  isFillForward: boolean;
}
```

- Add to `SimBrokerConfig` (+ defaults): `maxStaleBars: number` (default `0` = no limit) and `staleDataPolicy: "allow" | "pend" | "reject"` (default `"allow"`, so Phase 1 changes no outcomes).
- Deprecate `PortfolioState.currentBar` (mark `@deprecated`, stop reading it; removed in Phase 3).

### 1.2 `coreza-backend/src/backtest/simBroker/index.ts`
- Replace the `symbolStates` map value with `SymbolMarketState`; `getSymbolState(symbol)` seeds `{ latestBar: null, previousBar: null, isFillForward: false }`.
- `onBar(symbol, bar, meta?)` — accepts either the legacy `(symbol, bar)` shape or a `MarketBarEnvelope`. It must:
  - throw `Symbol/bar mismatch` when an envelope's `symbol` differs from the argument,
  - shift `previousBar = latestBar` and set `latestBar = bar` **before** processing pending tickets for that symbol (so the fill model sees `(latestBar, previousBar)` exactly as it does today via the existing `symbolState.previousBar` argument — verify the next-bar-open model still receives the same pair),
  - record `sourceTimestamp`, `eventTimestamp`, `isFillForward`,
  - stop writing `this.state.currentBar`.
- `tryFillImmediateOrder(orderId)` — drop the `bar` parameter (keep an overload accepting a bar for one release, ignoring it and logging once). New body resolves the bar itself:

```ts
const market = this.getSymbolState(order.symbol);
if (!market.latestBar) return null;               // NO_MARKET_DATA -> stays pending
if (!this.isMarketDataEligible(market)) return null; // staleness policy
// fill/slippage/commission/applyFill all use market.latestBar
```

- New private `isMarketDataEligible(state)`: `true` when `maxStaleBars === 0`, otherwise compares `eventTimestamp - sourceTimestamp` against `maxStaleBars` intervals; `"reject"` policy surfaces the reason on the order (`rejectReason: "STALE_MARKET_DATA"`), `"pend"` returns false and leaves the ticket pending.
- `estimateOrderPrice(order)` — remove the `this.state.currentBar?.close` fallback; chain becomes `explicit order price -> latestBar.close -> previousBar.close -> lastFillPrice -> 0`. `validateOrder` already rejects with `No market price available for <symbol>`, which now correctly fires for an unpriced symbol instead of silently borrowing the trigger symbol's price.
- Delete `setCurrentBar` (kept as a deprecated no-op in Phase 1, removed in Phase 3).
- `updatePositionMTM` continues to use the order-symbol bar close from `onBar` — unchanged.

### 1.3 `coreza-backend/src/backtest/BacktestExecutor.ts` (BacktestTrade path)
- Remove the `simBroker.setCurrentBar(currentBar)` call.
- Call `simBroker.tryFillImmediateOrder(orderResult.orderId)` with no bar, and no longer gate it on `currentBar` being present — an immediate order for a symbol with cached data must fill even when the triggering node passed no bar.
- Keep parsing `current_bar` for node output/back-compat only.
- Include `symbol`, `fill_price`, and a new `market_data_symbol` in the node result so a mismatch is visible in run history.

### 1.4 Regression tests (write these first, they should fail before 1.1-1.3)
`coreza-backend/tests/simBrokerCrossSymbolPricing.test.ts`:
- AAPL close 220 / OTLK close 1.40; feed both via `onBar`, then submit an OTLK market sell while "processing" AAPL -> fill price derives from 1.40, never 220.
- Only AAPL cached; submit an OTLK order -> rejected at validation (`No market price available for OTLK`) or left pending, never filled.
- Limit/stop orders keep their existing pricing behaviour (no regression in `simBroker` buying-power tests).

## Phase 2 — Fill-forward and staleness visibility

### 2.1 `BacktestExecutor.alignMultiSymbolBars`
- When copying a prior bar forward, emit `{ ...previousBar, time: timestamp, sourceTime: previousBar.time, isFillForward: true }` and mark real bars with `sourceTime: bar.time, isFillForward: false`.
- `MultiBarEvent` gains an optional `fillForwardSymbols: string[]` for observability.

### 2.2 Bar plumbing
- `coreza-backend/src/backtest/session/BacktestSession.ts` (three `onBar` call sites at ~440, ~509, ~626) and `PortfolioExecutor.ts:312` build a `MarketBarEnvelope` from the aligned bar (`sourceTimestamp = bar.sourceTime ?? bar.time`, `eventTimestamp = event timestamp`, `isFillForward`) and pass it to `onBar`. Call sites without that metadata fall back to `sourceTimestamp = bar.time, isFillForward: false`, so behaviour is unchanged.
- Fills carry the flag through: `OrderEvent` gains optional `usedFillForwardData?: boolean` and `marketDataAgeMs?: number`, populated from the symbol's market state at fill time and persisted with the trade record for audit.

## Phase 3 — Liquidation API

### 3.1 `SimBroker.liquidate(symbol, options)`
```ts
liquidate(symbol: string, options?: { orderType?: OrderType; limitPrice?: number; tag?: string })
  : { success: boolean; orderId?: string; error?: string; quantity?: number; side?: "buy"|"sell" }
```
- Reads `this.state.positions[symbol]`; no position or `quantity === 0` -> `{ success: false, error: "NO_POSITION" }`.
- Computes side from the sign of the position quantity (long -> sell, short -> buy) and quantity `Math.abs(qty)`, **minus** any already-pending closing quantity for that symbol (scan `pendingTicketsBySymbol`) so a duplicate liquidation cannot over-close; when the remainder is 0 -> `{ success: false, error: "LIQUIDATION_ALREADY_PENDING" }`.
- Submits through the normal `placeOrder` path — no special pricing, no direct position mutation — then, under the immediate model, calls `tryFillImmediateOrder(orderId)` (which resolves the *liquidated* symbol's bar).
- Position `averagePrice` is never used as a fill price.

### 3.2 Node surface
- `src/nodes/BacktestTrade.json`: add an `operation` select (`place_order` default, `liquidate`); when `liquidate` is selected, show `symbol`, `order_type`, `tag` and hide `side` / `quantity` / prices via `displayOptions`.
- `BacktestExecutor`'s BacktestTrade handler branches on `operation === "liquidate"` and delegates to `simBroker.liquidate(...)`, returning the same result shape (`order_id`, `fill_price`, `fill_quantity`, `cash`, `positions`, `total_equity`).
- Cleanup in the same PR: delete the deprecated `setCurrentBar` no-op, the `tryFillImmediateOrder(orderId, bar)` overload, and `PortfolioState.currentBar`.

### 3.3 Tests — `coreza-backend/tests/simBrokerLiquidation.test.ts`
- Long 500 -> sell 500; short -500 -> buy 500.
- Cross-symbol: liquidate OTLK during an AAPL event -> fill at the OTLK price.
- Duplicate liquidation before fill -> second rejected, no over-close.
- Partial fill -> ticket stays pending with the correct remaining quantity, second liquidation call still blocked.
- No position -> `NO_POSITION`, no order created.

## Out of scope (explicit)
- Quote/bid-ask-aware fill models.
- Any change to live/broker pricing — broker-reported `avgFillPrice` stays authoritative.
- Signal generation, indicators, or using a user RollingWindow as execution authority.

## Definition of done
The price used for any simulated order is a function of the order symbol's cached market data and the configured reality models, and `SimBroker` exposes no API that can accept another symbol's bar as pricing input.
