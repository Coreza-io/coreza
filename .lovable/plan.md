# Review of the gap-closing implementation + one compile fix

## Verified correct

- **A1** — `liquidate` cancels every pending non-market ticket for the symbol first and collects `canceledOrderIds` (`simBroker/index.ts:593-606`); `cancelOrder` handles reservation release and pending-index removal.
- **A2** — After `placeOrder`, an immediate fill is attempted when `fillModel === "immediate"` and returned as `fill` (`:643-653`); the discriminated `LiquidationResult` is exported from `interfaces.ts:121-136`.
- **A3** — The lock is now acquired before the cancel sweep and released in a `finally` wrapping the whole sequence (`:591-656`), so reentrant calls hit `LIQUIDATION_IN_FLIGHT`.
- **A4/D1** — The executor liquidate branch returns `canceled_order_ids`, `order_id`, `order_status`, `fill_price`, `fill_quantity`, `commission`, `slippage` plus provenance; the place-order path sets the same provenance fields on `tradeResult.data` (`BacktestExecutor.ts:782-826, 910-914`).
- **B1/B2** — `isCausallyEligible` reads `sameBarPolicy` (`>` strict, `>=` allow-close), applies to conditional orders and everything under `next_bar_open`, and is called from both `onBar` (`:545`) and `tryFillImmediateOrder` (`:721`); the ad-hoc `eventTimestamp < submittedAt` guard is gone.
- **C1** — `validateEnvelope` checks symbol, finite OHLC, positive finite timestamps, `source <= event`, and per-symbol monotonic event clock; it throws in test env, warns once per `symbol:reason` via `envelopeWarnings`, and returns `[]` before any state mutation (`:380-499`).
- **C2** — The legacy positional `onBar` compares `bar.symbol` / `bar.Symbol` against the argument, throws in test env, and increments `legacySymbolMismatches`, exposed from the counters accessor (`:471-478, 1642-1647`).
- **C3** — `fillTicket` no longer takes override bars and prices strictly off `context.bar` / `context.previousBar` (`:879-893`); MTM still uses the envelope close as planned.
- **D2** — `fillForwardSymbols` added to the multi-bar event type and populated by `alignMultiSymbolBars` (`BacktestExecutor.ts:51, 664-708`).

## One defect to fix

`OrderResult` was dropped from the `./interfaces` import list in `simBroker/index.ts` when `LiquidationResult` was added, so the file no longer compiles:

```
src/backtest/simBroker/index.ts(205,60): error TS2304: Cannot find name 'OrderResult'.
```

**Fix:** re-add `OrderResult` to the import block at `simBroker/index.ts:20-36` (it is still used as the `placeOrder` return type at line 205). Single-line change, no logic impact.

The only other backtest-area type errors are the two pre-existing ones (`PortfolioExecutor.ts:1803`, `routes/backtest.ts:398 cleanup`), untouched by this work.

## Not changed (by prior agreement)

- Phase 1/4/5 regression tests remain unwritten.
- Phase 6 cleanup (`setCurrentBar`, the legacy `onBar` overload, `PortfolioState.currentBar`) stays deferred until the legacy counters read zero.
