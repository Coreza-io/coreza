# Review: Cross-Symbol Liquidation & Symbol-Scoped Pricing — end-to-end check

## What is correctly implemented

- **Symbol-scoped market state**: `marketDataBySymbol` holds `latestRealBar` / `previousRealBar` / `latestEventTimestamp` / `lastFillPrice` / `lastEnvelopeWasFillForward`. Fill-forward envelopes advance only the event clock and never replace the last real observation (`simBroker/index.ts:423-441`) — matches LEAN `SecurityCache`.
- **Single market boundary**: `resolveMarketContext(order)` reads strictly from `order.symbol` (`:629`), `classifyMarketData` is pure and order-type aware (`:654`), `applyEligibilityTransition` does status + pending-index removal + reservation release + `OrderEvent` atomically (`:732`).
- **Global fallback removed**: `setCurrentBar` throws in tests / warns and no-ops in prod; `estimateOrderPrice` no longer reads `state.currentBar` and only falls back to the same symbol's data (`:1115-1143`).
- **Fill path**: `tryFillImmediateOrder(orderId)` takes no bar; the legacy bar arg is rejected in tests. Slippage/fees/`applyFill` all run off the resolved context bar.
- **Provenance**: every fill and rejection event carries `marketDataSymbol`, source/event timestamps, `marketDataAgeMs`, `usedFillForwardData`, `fillModel`, `referencePrice`, `rejectionReason`.
- **Fill-forward provenance upstream**: `alignMultiSymbolBars` stamps `_sourceTimestamp` / `_isFillForward` and keeps the original source timestamp across repeats (`BacktestExecutor.ts:668-688`); `toMarketBarEnvelope` is used at all three `BacktestSession` sites, the MTM site in `BacktestExecutor`, and `PortfolioExecutor.ts:313`.
- **Liquidation**: signed pending-market-quantity arithmetic, submitted through the normal `placeOrder` path, never mutating the position; `BacktestTrade.json` has the `operation` select with correct `displayOptions`; the route forwards `operation`.
- **Typecheck**: no new errors in backtest files (the two remaining, `PortfolioExecutor.ts:1803` and `routes/backtest.ts:398 cleanup`, are pre-existing).

## Gaps to close

1. **Liquidation does not cancel non-market open orders** (plan step 3). A resting limit/stop on the symbol survives liquidation and can re-open a position. Cancel every pending non-market ticket for the symbol before computing the target.
2. **Liquidation never attempts an immediate fill.** Under `fillModel: "immediate"` the place-order path in `BacktestExecutor` calls `tryFillImmediateOrder`, but the liquidate branch (`BacktestExecutor.ts:774-792`) returns without it, so a liquidation silently waits for the next bar. Call `tryFillImmediateOrder(orderId)` inside `SimBroker.liquidate` after `placeOrder` and surface `fill_price` / `fill_quantity` in the node result.
3. **`liquidationLocks` is a no-op.** It is added and removed inside one synchronous call, so it can never be observed. Either drop it or hold it across the fill attempt; duplicate protection today comes only from the signed arithmetic.
4. **`sameBarPolicy` is declared in config but never read.** The only causality guard is `envelope.eventTimestamp < order.submittedAt` (`:466-471`), which still lets a conditional/next-bar order fill from the very bar it was submitted on. Implement the plan rule: conditional and next-bar orders require `sourceTimestamp > order.submittedAt` unless `sameBarPolicy === "allow-close"`.
5. **Envelope validation missing.** `onBar` does not check finite timestamps, `sourceTimestamp <= eventTimestamp`, or monotonic `eventTimestamp` per symbol. Add the guard (warn + skip, throw in test env).
6. **Legacy `onBar(symbol, bar)` adapter does not assert symbol identity** against any symbol carried on the bar; the plan asked for throw-in-test / telemetry-in-prod.
7. **Fill bar inconsistency.** `onBar` passes the envelope bar into `fillTicket` as `overrideBar`; during a fill-forward event that bar is a copy stamped with the event clock, while `context.bar` is the real observation. Prefer `context.bar` (or document the override) so price and timestamp provenance agree.
8. **Node output does not expose provenance** (plan 2.3): add `market_data_symbol`, `market_data_age_ms`, `used_fill_forward_data` to the BacktestTrade result.
9. **`MultiBarEvent.fillForwardSymbols`** was not added (optional; only affects debugging visibility).
10. **Phases 1, 4, 5 tests are absent** — intentionally skipped per your earlier direction. Phase 6 cleanup (deleting `setCurrentBar`, the legacy `onBar` overload, `PortfolioState.currentBar`) is still pending by design.

## Proposed fix scope

Items 1-4 are behavioural correctness and should be fixed together in `simBroker/index.ts` plus the liquidate branch in `BacktestExecutor.ts`. Items 5-8 are hardening/observability. Item 9-10 optional.
