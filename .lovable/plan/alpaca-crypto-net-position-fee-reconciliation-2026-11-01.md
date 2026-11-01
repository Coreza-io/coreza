# Alpaca crypto net-position and base-asset fee reconciliation — implementation plan

**Branch:** `dev`  
**Scope:** Plan only. No runtime changes.  
**Priority:** High — live portfolio accounting correctness  
**Goal:** Keep Alpaca gross fill quantity (e.g. 1 ETH) unchanged while accurately recording the broker's net position (e.g. 0.9975 ETH), without inventing a fee, corrupting cash/cost basis, double-counting activities, or slowing every market tick.

## Confirmed code locations (dev)
- `coreza-backend/market-stream-service/src/marketGateways/alpaca/helpers.ts` (~277–285): `data.qty` => `filledQty`, `order.filled_qty` => `cumulativeFilledQty`, `data.position_qty` => `positionQty`. These have different semantics and must be kept separate.
- `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` (~1208–1251): `sync_order_event` passes quantity, fee, fee asset and position quantity into `pm.applyOrderEvent`; reporting is fire-and-forget (~1290).
- `coreza-backend/src/simulation/PortfolioManager.ts` (~304–324): `normalizeFill` and accepted order progress already distinguish cumulative and incremental quantities.
- Same file (~355): a non-quote fee is currently rejected; (~362–363): gross-fill calculated position is strictly compared to the broker snapshot; (~364, 379–402): cash, cost basis, fee totals and closed-trade accounting depend on fee treatment.
- Same file `applyPositionUpdate` (~1040 onward) is designed to reject arbitrary position quantity changes when tracked costs exist; **do not bypass it**.
- Relevant earlier plan: `.lovable/plan/portfolio-cumulative-filled-quantity-2026-10-25.md`. Preserve cumulative-versus-delta semantics and idempotence.

## Financial contract / invariants
1. **Gross fill** is the executed quantity for order progress, executions, and trade history; **net position delta** is the asset change after any base-asset fee. Never replace gross `filledQty=1` by `0.9975` in order history.
2. For an eligible BUY snapshot with exact, trusted previous broker position and no intervening changes: `netReceived = currentBrokerQty - previousBrokerQty`, `inferredBaseFeeQty = grossIncrementalBuyQty - netReceived`. Example prior 2, gross +1, current 2.9975 => net +0.9975, inferred fee 0.0025.
3. The formula is **not universally safe**. Only infer on validated, contiguous order/fill events for the same broker account + environment + credential + symbol + position ownership, with broker-provided snapshot timing/ordering or independently verified baseline. Overlapping orders, external trades, transfers, stale/out-of-order updates, rounded snapshots, missing initial state or duplicate events => `reconciliation_pending`, not manufactured fee.
4. Net-balance reconciliation is not automatically fee reconciliation. Store `inferred` vs `confirmed` classification; do not treat a raw discrepancy as a verified broker fee.
5. For a BUY with a fee charged in the base asset: `netBaseQty = grossBuyQty - baseFeeQty`, quote cash debit generally remains gross executed notional (unless explicitly charged a quote fee); base fee reduces quantity received. For a SELL, require broker-specific fee behavior: quote fee reduces quote proceeds; base-asset fee (if documented/observed) requires an additional base debit and is **not** silently treated as buy logic. Reject unsupported mixed/third-asset fees pending explicit valuation/FX semantics.
6. Preserve accurate inventory cost basis and realized P&L. For base-fee-on-buy, net quantity and gross acquisition cost must be consistent with cost-basis policy; fee reporting must not double count economic cost. Keep fee's native asset quantity and any quote valuation separate, recording valuation provenance and time.
7. `positionQty` is an **absolute account-level snapshot**, not per-fill quantity. If Coreza's manager is only tracking strategy-attributed inventory, compare to an appropriately scoped broker baseline + strategy-attributed delta; do not compare raw account-wide position with strategy-only holdings.
8. Decimal-safe arithmetic throughout. No arbitrary epsilon masking accounting errors; use only documented instrument precision/rounding normalization with explicit logs.
9. Missing `position_qty` is `undefined`, never default zero. Broker reported sellable quantity is the hard cap for immediate sell decisions when known.
10. No broker REST, Postgres, or delayed fee activity lookup on market tick execution path. Confine reconciliation work to order events / background processing, never re-run reconciliation for each quote tick.

## Proposed minimal changes

### Phase A — source and lifecycle audit
- Trace Alpaca raw trade update -> normalized market event -> workflow node bindings -> PortfolioExecutor `sync_order_event` -> PortfolioManager. Verify `filledQty` is incremental when using `data.qty`; `cumulativeFilledQty` is order-to-date and controlled by existing checkbox. Avoid conflating both on duplicate updates.
- Capture representative BUY/SELL/partial-fill events with `event`, `order.id`, `execution_id`, `data.qty`, `order.filled_qty`, `data.position_qty`, timestamps, status and any actual fee fields. Confirm if `position_qty` is consistently populated and at what event boundary.
- Confirm Alpaca fee data availability and currency (trade updates vs account activities). Establish broker-specific base-asset fee policy from actual payloads; no hardcoded 0.25%.

### Phase B — event contract and trusted baseline
- Add a minimal optional internal reconciliation envelope (do not change persisted workflow node inputs): `brokerPositionQty`, `snapshotEventId/timestamp`, `snapshotTrust`, `previousAcceptedBrokerPositionQty`, `netBaseDelta`, `baseFeeQty`, `feeAsset`, `feeSource: broker_explicit | snapshot_inferred | activity_confirmed | unknown`, `reconciliationStatus`.
- Persist/restore a scoped checkpoint keyed by broker + environment + account/credential + symbol, last accepted event/order progress and broker baseline; serialize reconciliation per scope/symbol and use idempotency keys to avoid concurrent adjustments. Integrate with existing accepted fill/owner registry; no new database tables unless existing ledger cannot support durable recovery.
- For newly started workflows on accounts with existing positions, establish reliable broker baseline before attributing fees; otherwise mark unresolved and avoid false mismatch.

### Phase C — calculations and atomic transition
- Keep `normalizeFill` gross order progress unchanged. Calculate `grossDelta` first and dedupe event.
- If explicit broker base fee is supplied and verified, apply it. Else calculate provisional `netDelta` from trusted prior/current broker position snapshots *only* when they bracket exactly this incremental fill and no other quantity movements.
- Infer `baseFeeQty = grossDelta - netDelta` only for allowed BUY events, nonnegative and consistent with precision/rate plausibility checks. Inconsistent values are anomalies, **not** fees.
- Extend `calculatePositionFill` and/or a narrow call-site adapter so position inventory reflects net acquired quantity, gross execution notional remains unchanged, quote cash reflects the correct fee denomination, and entry cost basis / fee quantities / P&L reconcile. Explicitly define what `feesTotal` means if fee is in base asset; do not add quantities from different assets to the same numeric total.
- Replace unconditional line-363 equality with: compare calculated net position against trusted, correctly scoped broker snapshot when safely comparable; otherwise record a pending reconciliation and block risky sell sizing. Retain hard errors for confirmed irreconcilable accounting violations.
- Apply all affected position, cash, fill progress, fee accounting and audit/checkpoint state atomically within the accepted event transition. A rejected event must not partially update state; retries must not double-deduct fees.
- Existing `applyPositionUpdate` remains a snapshot/mark reconciler and must not manufacture quantity or cost basis.

### Phase D — eventual fee activity confirmation
- Outside live tick path, fetch/process Alpaca posted crypto fee activities (`CFEE`/`FEE` if available) and reconcile by account, symbol, time, order/execution identifiers or safe aggregation windows.
- Store provenance and activity IDs; confirm or correct provisional fee delta **once** with balanced adjustment entries (including cash, cost basis, realized P&L where relevant). Never apply a posted fee as a second deduction if already inferred.
- If fee activity cannot be safely tied to the fill, flag unresolved instead of assigning it to a guessed order. Handle late or revised activities and restart/replay idempotently.

### Phase E — downstream propagation and observability
- Update `PortfolioExecutor` event output and reporting mapping to preserve both gross executed qty and net attributed holding change. Keep existing external field semantics backward-compatible; add optional `netPositionDelta`, `baseFeeQty`, `feeAsset`, `feeSource`, `reconciliationStatus` only where required.
- Ensure held quantity, sellable quantity, realized/unrealized P&L, weighted entry cost, order remaining, total fee display and trade history stay internally consistent.
- Structured logs for `grossFillQty`, `previousBrokerQty`, `brokerPositionQty`, `netPositionDelta`, `inferredFeeQty`, `feeSource`, `status`, `reason`, `accountScope`, `orderId`, `executionId`; log discrepancies without credential secrets.
- Metrics: accepted/duplicate/stale events, inferred/confirmed/unresolved fee count, reconciliation latency (event pathway only), blocking mismatches, state-recovery outcomes. No extra per-tick awaits.

## Acceptance scenarios (implementation must cover)
1. Buy 1 ETH, previous broker holding 0, new 0.9975 => order filled 1, holding 0.9975, provisional base fee 0.0025, correct cost basis/cash.
2. Buy 1 ETH, previous broker holding 2, new 2.9975 => same fee, absolute holding 2.9975 *only if portfolio tracks account-level inventory*, or strategy holding reconciled against baseline.
3. Two partial fills (0.4 then 0.6) with sequential fee-adjusted snapshots: aggregate net and fee match final state; order gross progress remains 1.
4. Duplicate event and cumulative replay => zero incremental position/cash/fee mutation.
5. Missing/stale snapshot, external trade, transfer, multi-order overlap, changed account scope => pending reconciliation, no invented fee and no unsafe auto-sell.
6. Buy followed immediately by close: sell uses broker-confirmed available qty; accurate realized P&L, no oversell.
7. SELL with quote fee, SELL with possible base fee, and BUY with quote fee => asset-specific cash and quantity treatment verified.
8. Later posted `CFEE` activity matches provisional fee => mark confirmed, no duplicate charge; mismatch => correction entry/audit.
9. Restart between fill and fee posting => idempotent recovery without cumulative quantity duplication.
10. Existing equities, backtests, Binance, and non-Alpaca workflows retain existing semantics and timing.

## Implementation order and guardrails
1. Audit exact Alpaca live payload semantics + current existing checkpoint/ledger. Resolve which snapshots are safe to pair.
2. Extend fee/snapshot normalization with **optional** internal fields and no workflow migration.
3. Implement trusted snapshot baseline and reconciliation state, then fee-aware inventory and cost basis, then guarded comparison.
4. Hook into existing async persistence/fee activity processor only as required; preserve no-DB/no-network hot tick path.
5. Verify the acceptance scenarios above with deterministic unit/integration cases and recorded Alpaca payloads before enabling live trading. No code or tests are to be run as part of writing this plan.
6. If a reliable prior-position baseline cannot be guaranteed for an event, do not derive a fee; suspend automatic sizing against unconfirmed inventory, request async reconciliation, and surface a specific reason.

**Non-goals:** changing broker order filled quantity to net, removing validation wholesale, assuming 0.25% fee, defaulting missing broker positions to zero, adding an API request on every market tick, refactoring unrelated portfolio components, or modifying runtime code in this plan-only change.
