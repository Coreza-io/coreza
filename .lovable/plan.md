# Lean-parity corrections for SimBroker accounting

Scope is **calculation correctness only**. No read-purity refactor, no `onBar` rename, no new node requirements — the user composes `update_mtm` / portfolio nodes in the workflow as they see fit. `onBar` keeps its current name and its current behaviour of evaluating pending orders.

The uploaded review (`Coreza_Lean_Backtesting_Portfolio_Comparison_and_Corrections.pdf`) compares our engine against Lean. Its accounting findings are correct — re-verified against `main`:

- **P0-001 slippage double-count** — `coreza-backend/src/backtest/simBroker/index.ts:342` sets `adjustedPrice = fillResult.price + slippage` (used for cash and average price), then `:615` computes `netPnl = grossPnl - totalCommissionForTrade - totalSlippageForTrade`, deducting slippage a second time.
- **P0-003 realized P&L disappears on close** — `simBroker/index.ts:645` does `delete this.state.positions[order.symbol]` when quantity reaches zero, and portfolio summaries aggregate `Object.values(state.positions)` only (`PortfolioExecutor.ts:1018/1467/1594/1667/1686`, `BacktestExecutor.ts:1146/1245`). Closed-trade P&L is dropped from the summary.
- **P1-005 unsigned fillQuantity** — `simBroker/index.ts:369` and `:483` write `fillQuantity: fillResult.quantity` (always positive) into `OrderEvent`, so an event stream cannot be replayed into holdings.
- **P1-006 ticket average price overwritten** — `averageFillPrice` is assigned the latest fill price instead of a weighted average across partial fills.

## Explicitly dropped from this plan

- **CZA-PORT-002 (pure portfolio reads)** — not doing it. `onBar` stays as-is and query paths keep calling it. The user controls when MTM/portfolio nodes run via the graph.
- Any rename of `onBar` → `processExecutableBar`.
- Phase 4 Lean features (currency cash book, settlement, corporate actions).

## Phase 0 — Reproduction tests

Add under `coreza-backend/tests/`, each landing green with its phase:

- `simBrokerSlippageReconciliation.test.ts` — zero commission; buy 100 @ raw 10 with +0.10 slip, sell @ raw 12 with +0.12 slip. Assert `finalCash - initialCash === sum(trade.netPnl)` and equals 178.
- `simBrokerRealizedPnlPersistence.test.ts` — buy 100 @ 10, sell 100 @ 12, no costs. After the close, portfolio summary `realized_pnl === 200` (currently 0 because the position was deleted).
- `orderEventSignedQuantity.test.ts` — buy 40 → `fillQuantity === +40`; sell 40 → `fillQuantity === -40`; replaying the event stream from zero reproduces holdings.
- `ticketWeightedAverage.test.ts` — 40 @ 10 then 60 @ 12 → `quantityFilled === 100`, `averageFillPrice === 11.20`.
- `pendingBuyingPowerReservation.test.ts` — cash 10,000; accept a pending buy with est. cost 8,000; a second independent 8,000 buy must be rejected.
- `syntheticBarNoFill.test.ts` — two symbols with non-overlapping timestamps; a pending order on the symbol with no real bar must not fill on the forward-filled timestamp.

## Phase 1 — Slippage convention (P0-001)

- In `applyFill`, treat `adjustedPrice` as the **economic execution price**. Change the closing-trade calculation to `netPnl = grossPnl - totalCommissionForTrade` — remove the `- totalSlippageForTrade` term.
- Keep `totalSlippageForTrade` on `Trade` as a **diagnostic/reporting** field only. Stats aggregation at `:799` already derives slippage from `|adjustedFill − rawReference| × qty` and stays unchanged.
- Add a comment block at the top of `simBroker/index.ts` stating the convention: *adjusted price is the actual execution price; slippage is recorded for analytics and never deducted again from P&L*.

## Phase 2 — Durable realized P&L (P0-003)

- Extend `PortfolioState`:
  ```ts
  cumulativeRealizedPnl: number;                 // portfolio-wide, survives position close
  realizedPnlBySymbol: Record<string, number>;
  cumulativeFees: number;
  ```
- In `applyFill`, increment both counters on any closing quantity **before** the `delete this.state.positions[...]` branch at `:645`.
- Change every `realized_pnl` summary source to read `state.cumulativeRealizedPnl` instead of summing open positions: `PortfolioExecutor.ts` (L1018, L1467, L1594, L1667, L1686) and `BacktestExecutor.ts` (L1146, L1245).
- Mirror the same three fields onto `simulation/PortfolioManager.ts` state so the live path shares the shape (population wired in Phase 5).

## Phase 3 — Order event and ticket semantics (P1-005, P1-006)

**Signed fill quantity**
- `simBroker/index.ts:369` and `:483`: `fillQuantity: order.side === 'sell' ? -fillResult.quantity : fillResult.quantity`.
- Add optional `absoluteFillQuantity` to `OrderEvent` in `types/order.ts:94` for display.
- Grep frontend consumers of `event.fillQuantity` (`src/components/backtest/OrdersTable.tsx`, `TradesTable.tsx`) and use the absolute field where a magnitude is shown.
- Persisted historical runs: negate sell-side `fillQuantity` on read behind an idempotent `eventsSchemaVersion` flag on the run record, so old backtests still render correctly.

**Weighted average ticket price**
```ts
const newQty = ticket.quantityFilled + fillResult.quantity;
ticket.averageFillPrice =
  (ticket.averageFillPrice * ticket.quantityFilled + adjustedPrice * fillResult.quantity) / newQty;
ticket.quantityFilled = newQty;
```
- Fill models must be asked for the **remaining** quantity (`order.quantity − ticket.quantityFilled`), not the full order quantity, on each subsequent attempt.

## Phase 4 — Buying power and synthetic bars (P1-007, P1-008)

- Add `state.reservedCash` and `state.reservationsByOrderId`. `validateOrder` checks `estimatedCost <= state.cash - state.reservedCash`. Reserve `notional + estimatedFee` when a pending order is accepted; release or adjust on fill, cancel, replace, reject, and expiry.
- Locate the multi-symbol bar aligner under `coreza-backend/src/backtest/` and mark carried-forward bars with `bar.isSynthetic = true`. In `onBar`, when `bar.isSynthetic` is set, update mark-to-market only and skip pending-order evaluation — a forward-filled price is not a tradable print.

## Phase 5 — Shared accounting core (optional, after Phases 1-4 are green)

Extract the cash/holdings/realized-P&L arithmetic into `coreza-backend/src/portfolio/PortfolioLedger.ts` with a single immutable fill contract:

```ts
interface PortfolioFill {
  executionId: string; orderId: string; symbol: string;
  signedQuantity: number; fillPrice: number;
  rawReferencePrice?: number; slippagePerUnit?: number;
  fee: { amount: number; currency: string };
  contractMultiplier: number; timestamp: string;
}
```

`SimBroker` keeps ownership of order matching and `onBar`; it just delegates state mutation to the ledger. `simulation/PortfolioManager.ts` normalizes live broker executions into the same `PortfolioFill` and calls the same code, so backtest and live P&L cannot drift. Ship behind a `USE_PORTFOLIO_LEDGER` flag for one release.

## Invariants added to CI

- Replaying all fills from zero reproduces current cash and holdings.
- Once every position is flat: `finalEquity − initialEquity === cumulativeRealizedPnl`.
- `sum(ticket fees) === state.cumulativeFees`.
- A fill is applied at most once per `executionId`.

## Risk

Phase 1 changes reported P&L for any historical run that had non-zero slippage (the numbers become correct — previously they were pessimistic). Bump a `schemaVersion` on backtest run records and label older runs in the results UI so the difference is explainable. Phase 3's signed quantity is the only wire-format change; the read-time migration keeps old runs displayable.
