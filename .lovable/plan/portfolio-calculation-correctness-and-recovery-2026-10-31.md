# Portfolio calculation correctness and recovery plan

Status: implementation plan only. No application, database, broker-account, or historical-data changes are made by this document.

Target branch: dev
Date: 2026-10-31
Reviewed source: 04bfbd24f57368ded50bd9d3d886cc862bd64c66
Priority: portfolio correctness before live execution optimization
Initial supported scope: long-only cash equities and spot crypto, subject to each broker's supported account/instrument model

## 1. Objective and decisions

Make Portfolio outputs safe to use in workflow conditions and order sizing by defining exactly how execution events change quantities, cash, cost basis, fees, realized profit, unrealized profit and equity. Correctness must hold for partial executions, duplicate delivery, cumulative order updates, cancellations, fractional units and recovery.

Keep the existing Portfolio node, PortfolioManager, SimBroker, reporting repositories and live/backtest output contracts where possible. Introduce a small pure accounting/normalization layer and repair their integrations rather than rewrite the workflow engine.

Decisions:
1. Normalize broker input into unique incremental economic events before any financial mutation.
2. Apply each accepted event as one validated state transition across orders, positions, cash, fees and realized accounting.
3. Use explicit quantity, price and fee semantics; never infer them solely from broker name or field labels.
4. Use decimal arithmetic at accounting boundaries and throughout financial accumulation. Round for display or according to instrument/currency rules, not after every arithmetic operation.
5. Preserve broker account truth separately from a workflow's attributed/allocated portfolio.
6. Reuse financial calculation rules across live and backtest. Broker truth and simulated fill generation remain different adapters.
7. Market-price updates stay in memory. Durability/reconciliation for executions is essential and may require an awaited execution-event write; do not silently trade correctness for lower tick timings.
8. Futures accounting is a separate model, even for a long position. Do not claim futures correctness from passing spot tests.

Completion means a verified, replayable accounting model and consistent downstream outputs, not just a corrected dashboard total.

## 2. Evidence and baseline

The review used repository source at the SHA above and seven isolated local scenarios against the actual methods. Imports/external services and ownership lookup were stubbed; the SimBroker fee scenario invoked its accounting method directly. These checks establish narrow reproducible defects, not production integration coverage or a passing repository test suite.

| ID | Scenario | Expected | Observed | Priority |
| --- | --- | --- | --- | --- |
| P01 | UI-documented cumulative buy quantities 0.3, 0.5, 1 at price 100; initial cash 1000 | Quantity 1, order filled 1, cash 900 | Quantity/order filled 1.8, cash 820 | P0 |
| P02 | Replay one buy execution of 0.5 at 100 | Apply once: quantity 0.5, cash 950 | Quantity 1, cash 900; order record can remain at 0.5 | P0 |
| P03 | Same replay with authoritative resulting position 0.5 | Quantity 0.5, cash 950, equity 1000 | Quantity 0.5, cash 900, equity 950 | P0 |
| P04 | Buy 1 at 100 and sell 1 at 110; entry/exit fees 1 each | Net profit 8 | Cash/equity gain 8; live reported trade profit 9 | P1 |
| P05 | Backtest buy 0.1 at 100 and sell 0.1 at 110; fees 1 each | Net profit -1 | Cash profit -1; reported trade profit about -0.10 | P1 |
| P06 | Buy 0.3, then sell 0.1 and 0.2 without absolute broker position | No position | Residual short quantity -2.7755575615628914e-17 | P0 for condition correctness |
| Control | Buy 2 at 100 and 3 at 110 | Quantity 5, average 106 | Passed | Baseline control |

Verified source observations:
- src/nodes/Portfolio.json describes filledQty as cumulative and says the executor derives deltas. PortfolioExecutor currently passes it through as an increment; the old computeFillDelta call is commented out.
- PortfolioManager.applyOrderUpdate adds event quantities. Sequence/status checks return only from order updating; they do not stop later position/cash mutation in PortfolioExecutor.
- PortfolioManager.applyTrade has execution-ID deduplication, but its skipped result does not guard the full financial transition.
- Live closing-trade aggregation accumulates exit fees without an allocated entry-fee balance.
- SimBroker.applyFill uses Math.max(1, entryQuantity) when allocating entry fees, which is incorrect for fractional quantities below one.
- Position closure uses number arithmetic and an exact zero comparison.
- PortfolioManager is RAM state scoped by user and execution/activation. Current initialization and broker synchronization must not be mistaken for durable accounting recovery.
- brokerSyncState currently supports Alpaca and updates returned positions; authoritative snapshot replacement, absent-position removal and broker-average replacement need explicit coverage.
- applyFillAccounting has a shared spot-style notional cash adjustment and no instrument-specific futures model.
- getPortfolioState/getTotalEquity primarily combine selected base cash and marked positions; multi-currency cash and fee conversion require an explicit valuation policy.
- LiveFillRepository upserts on user_id,broker,symbol,fill_id; account/environment namespace and immutable-event behavior need review before using this as an authoritative recovery ledger.
- FillSyncWorker reads new messages using XREADGROUP with ">". The inspected worker does not implement a pending-entry reclaim pass. Logging "will retry" is insufficient without actually re-reading pending entries.
- useLiveOrders aggregates quantities/notionals from rows and groups by order ID; it must receive unique incremental fills and preserve account scope.
- Existing portfolioTradeAggregation tests still pass brokerOrderId while the current applyTrade contract expects orderId. Correct these fixtures/expectations before relying on suite results.

The existing plan .lovable/plan/portfolio-cumulative-filled-quantity-2026-10-25.md remains relevant but covers only part of this work. This document is the umbrella plan; its current-source findings supersede older adapter descriptions where they differ.

Source entry points:
- https://github.com/Coreza-io/coreza/blob/04bfbd24f57368ded50bd9d3d886cc862bd64c66/src/nodes/Portfolio.json
- https://github.com/Coreza-io/coreza/blob/04bfbd24f57368ded50bd9d3d886cc862bd64c66/coreza-backend/src/nodes/executors/PortfolioExecutor.ts
- https://github.com/Coreza-io/coreza/blob/04bfbd24f57368ded50bd9d3d886cc862bd64c66/coreza-backend/src/simulation/PortfolioManager.ts
- https://github.com/Coreza-io/coreza/blob/04bfbd24f57368ded50bd9d3d886cc862bd64c66/coreza-backend/src/backtest/simBroker/index.ts
- https://github.com/Coreza-io/coreza/blob/04bfbd24f57368ded50bd9d3d886cc862bd64c66/coreza-backend/src/repositories/LiveFillRepository.ts
- https://github.com/Coreza-io/coreza/blob/04bfbd24f57368ded50bd9d3d886cc862bd64c66/coreza-backend/src/workers/FillSyncWorker.ts
- https://github.com/Coreza-io/coreza/blob/04bfbd24f57368ded50bd9d3d886cc862bd64c66/src/hooks/useLiveOrders.ts

## 3. Scope, portfolio identity and account truth

### 3.1 Supported books

Preserve workflow-scoped allocations/attribution as the existing behavior. Internally identify an accounting book by user, workflow, activation, broker, broker environment, credential/account identity and account model. Distinguish the activation identity from the broker's execution/trade ID: both are currently referred to as execution IDs in different places.

Separately maintain a broker account view for actual cash, available balance, open orders and positions. Do not overwrite a strategy allocation with the entire account balance or silently attribute pre-existing holdings to a new workflow.

Credential identity alone may not identify an account when credentials rotate or a broker exposes multiple accounts. Resolve and persist a stable non-secret account identity with a credential alias; include paper/testnet/live environment. Never put API keys into identities or logs.

If multiple workflows trade one account:
- Attribute owned fills to the correct workflow and activation.
- Never copy an account-wide absolute position into one strategy's attributed position.
- Aggregate strategy allocations and reservations against account availability.
- Before enabling shared-account allocation, implement one account-level reservation authority or restrict automated sizing to a supported exclusive-account configuration. Independent workflow cash maps cannot prevent double spending.

### 3.2 Out of initial scope

Shorting, options, leveraged-margin accounting, crypto futures, inverse/COIN-M contracts, tax-lot reporting and a workflow-engine performance refactor are separate workstreams.

However, deposits, withdrawals, dividends, splits, transfers and fee adjustments must be detected as non-fill events. Implement the supported adapter treatment or mark the book reconciliation-required and block dependent sizing. Silently ignoring an event affecting holdings/cash is not an acceptable supported behavior.

Until a proper futures adapter exists, expose unsupported accounting status and block automated decisions based on spot-derived futures balances. Do not change broker order APIs in this planning change.

## 4. Normalized event contract and compatibility

### 4.1 Common event envelope

Use a typed internal contract containing:
- Schema/calculation version and event kind: execution, order_status, position_snapshot, balance_snapshot, price, cash_movement, corporate_action or correction.
- Full book/account scope; source gateway generation and source cursor when available.
- Broker order ID, client order ID, stable broker execution/trade ID and original broker event timestamp.
- Broker instrument identity, asset class, base/quote currency and quantity/price increments.
- Side, individual execution quantity, execution price and execution quote notional.
- Optional raw order cumulative quantity, cumulative quote notional and cumulative average price.
- Fee components as amount, asset, semantic mode and stable identity; support multiple components.
- Optional absolute resulting broker position, clearly labeled account-wide rather than strategy-attributed.
- Order status separately from economic execution facts.
- Original input mode and raw decimal strings needed for audit/recovery.

Preserve decimal strings from native payloads before Number parsing. Do not reconstruct exact financial decimals from already-rounded floating-point output if the original value is available.

### 4.2 Quantity mode and UI

Honor the previously proposed Cumulative Filled Quantity checkbox, with an internal explicit quantityMode enum:
- Incremental: filledQty is this execution's quantity.
- Cumulative: filledQty is the order-to-date total.
- Legacy: missing setting preserves current incremental runtime interpretation during migration and produces a clear configuration diagnostic.

The earlier plan proposes cumulativeFilledQty as the boolean setting key. Native stream data also uses that name for a numeric total. Keep configuration and event payload typed/namespaced; never spread the native numeric field over the boolean setting. Resolve the setting from node configuration and map the native total into rawOrderCumulativeQty internally.

New nodes/templates must persist an explicit setting and explain the chosen input. Saved workflows with no setting must not acquire a new default just because node definitions changed. Fix misleading field help. Inventory templates and saved mappings before migration; do not infer meaning from the broker selector.

Price and fee interpretation are independently explicit. Add a price mode where necessary: execution price versus cumulative order VWAP. Fee components likewise specify individual versus cumulative. Changing an interpretation while an order is in progress requires a reconciliation boundary/new checkpoint, not just editing a field.

### 4.3 Cumulative conversion

Given previously accepted order totals Qprev and Nprev and incoming totals Qnew and Nnew:

~~~
deltaQty      = Qnew - Qprev
deltaNotional = Nnew - Nprev
executionPrice = deltaNotional / deltaQty, when deltaQty > 0
~~~

Prefer native cumulative quote notional. If only cumulative average is available, derive Nnew = Qnew * cumulativeAverage using the declared precision and validate it against native execution evidence when available.

Example: first cumulative quantity 1 at average 100 means notional 100. Next cumulative quantity 2 at average 105 means notional 210. The second execution is 1 at 110, not 1 at 105.

Rules:
- Equal cumulative totals create no new execution. A distinct fee or lifecycle update may still apply.
- Lower totals are stale/out-of-order input or a correction requiring reconciliation; never reset the high-water mark automatically.
- An increase without enough price/notional information is ambiguous; retain it and pause financial mutation pending evidence.
- Known partial-order baselines must be restored before interpreting the first post-restart event. Never assume previous cumulative quantity is zero for an existing order.
- Incremental and cumulative representations of the same execution must not both count.
- Late unique executions must not be discarded merely because their status rank is below the currently stored terminal status. Separate status monotonicity from economic-event acceptance.
- Cumulative conversion alone cannot safely handle arbitrary reordered incremental executions; use broker cursors/order history and reconciliation when ordering evidence is insufficient.

### 4.4 Event identity

Prefer a broker-provided execution ID, namespaced by account, environment, instrument and order as required by provider guarantees. Do not assume a trade ID is globally unique or that placeholder IDs such as -1 represent real executions.

Distinct fills with identical quantity/price must remain distinct. Do not deduplicate economic events by amount/price/time alone. If no stable execution ID exists, a durable order cumulative progression can provide identity when the provider guarantees it; otherwise fetch verified execution history or flag unsupported input rather than fabricate certainty.

Zero-fill lifecycle updates must not consume a future real fill's identity.

## 5. Accounting state transition

Introduce a pure reducer operating on one book's state. Keep public Portfolio operations as adapters to this path.

Proposed flow:
1. Resolve ownership and full account/book identity.
2. Validate event type, numeric inputs, instrument model, baseline readiness and interpretation.
3. Normalize quantity, notional and fees; check durable identity/progress.
4. Calculate the complete candidate state and derived reporting events without modifying the active book.
5. Check invariants and commit the accepted event/revision under the current single-owner fence.
6. Publish the complete immutable book revision in RAM.
7. Deliver derived fills/trades/snapshots through retryable, idempotent persistence.

No partial publication if a later calculation fails. Avoid mutating orders before discovering missing quantity/price or updating cash after rejecting an execution. Deduplication must guard the whole transition, not only applyTrade.

Separate memory-level atomicity from crash durability. A synchronous reducer prevents partial in-process state publication; it does not by itself provide durable exactly-once accounting or exactly-once broker order placement.

Duplicate economic events return accepted=false with a reason and unchanged financial revision. Status-only updates may advance lifecycle state through their own validated transition.

Direct operations such as reconcile_position, reconcile_balances and any legacy apply_execution/apply_order_update path must use the same authority/validation rules. Audit advertised operations against actual switch cases; remove unsupported UI options or implement their adapters rather than leaving nominal operations inconsistent.

## 6. Long-only calculation rules

### 6.1 Quantities and average cost

For a simple quote-currency-fee trade, track gross open cost and unallocated entry fees separately:

~~~
On buy:
  Qnew = Qold + executedQty
  grossOpenCostNew = grossOpenCostOld + executionNotional
  averageEntry = grossOpenCostNew / Qnew
  unallocatedEntryFeesNew = oldEntryFees + entryFeeInBookCurrency

On sell:
  require soldQty <= availableAttributedQty
  allocatedGrossCost = grossOpenCostOld * soldQty / Qold
  allocatedEntryFee = unallocatedEntryFeesOld * soldQty / Qold
  grossRealized = sellNotional - allocatedGrossCost
  netRealized = grossRealized - allocatedEntryFee - exitFees
~~~

A reduction retains the remaining average entry cost. Use the actual remaining quantity as the allocation denominator; never clamp it to one unit. Allocate residual decimal cost/fee balances to the final close so no cents or fractional fees are stranded.

Maintain realized accounting on every closing execution, including partial exits. Do not delay realized P&L used by IF conditions until the exit order becomes terminal. Reporting may retain the current order-based aggregation, provided it is clearly a presentation grouping of already-accounted executions.

For strategy-generated oversells, reject sizing/submission before sending the order. For an actual broker fill revealing an unexpected short position, retain the broker fact and mark the long-only book unsupported/reconciliation-required; do not silently clamp or discard real execution evidence.

### 6.2 Cash, fees and cost-basis meanings

For quote-currency fees:
- Buy cash change = negative execution notional minus fee.
- Sell cash change = execution notional minus fee.
- Cash changes once per accepted economic event.
- Entry fees reduce cash when charged and are allocated to closed-trade net P&L later. Allocating them to P&L must not deduct cash again.
- Keep gross average execution price distinct from fee-inclusive economic basis. Define each public field precisely and preserve existing names with additive fields where needed.

For fees in the purchased asset:
- Preserve gross executed quantity and net received/held quantity separately.
- Debit the asset fee once. If an authoritative position snapshot already includes that fee, do not subtract it again.
- Define economic basis for the net units actually held and map broker-specific average-price conventions explicitly; do not apply the simple quote-fee formula blindly.

For third-asset fees:
- Debit that asset's balance and record a separate fee component.
- Convert into reporting currency using a timestamped, documented conversion source.
- If conversion is unavailable, preserve the native fee and mark converted P&L incomplete. Never silently assign zero.

Handle fee-only adjustments and supported rebates as explicit economic events with their own identities. Do not reject all negative fee amounts when a provider legitimately emits rebates.

### 6.3 Precision and validation

Use a shared decimal utility/library, pinned in package and lockfile if added. Evaluate precision/range against supported instruments and broker decimal strings; choose database numeric precision only after inventorying actual schema and maximum supported values.

- Quantity and tick increments come from instrument metadata; currency display precision is separate.
- Reject NaN, infinity, malformed decimals, invalid signs and missing positive execution prices.
- Do not default a missing broker equity to 1 or missing required cash to 0.
- Whole-share and fractional-share restrictions are broker/instrument-specific.
- Closing a mathematically zero balance must yield no position. Preserve genuine tradable dust; do not use an arbitrary global epsilon that deletes small valid holdings.
- Convert to JSON-compatible strings/numbers only at explicit boundaries; no BigInt or Decimal objects leaking into node results.
- Keep compatibility numeric fields only within a documented safe range and tolerance. Exact values remain available for accounting and audit.
- Reject unsupported ranges rather than silently overflowing or losing significant quantity.

### 6.4 Valuation, return and drawdown

Use explicit instrument prices and FX conversions:

~~~
equity = sum(each cash balance * its FX-to-book rate)
       + sum(each owned long position's marked value in book currency)
~~~

Do not count a spot base asset twice as both cash inventory and a position. Choose one canonical economic representation and derive alternate views.

Price updates change only valuation fields, not quantity, cash, execution average or realized P&L. Update cached totalPnl consistently with the public getters. Reject invalid/stale marks according to a documented policy and expose valuation completeness.

Update peak equity once from the fully committed, fee-adjusted/marked book revision. Intermediate cash/fee mutations must not inflate the peak. Drawdown is (peak-equity)/peak when peak is positive; otherwise expose a defined unavailable/zero state without division by zero.

Keep raw equity return separate from flow-adjusted performance. Deposits/withdrawals change equity and allocation but are not trading profit. Choose and document the reporting return methodology for books with external flows; do not reset the starting baseline on a later read or restart.

For a fully closed, single-currency book with no external flows or other income/charges:
  endingCash - startingCash = sum(net realized trade profits)

For open books, reconcile gross unrealized P&L and remaining entry fees explicitly. Do not subtract total fees again from equity if cash already reflects them.

### 6.5 Buying power and reservations

For an unleveraged cash strategy:
  availableForNewBuys = allocatedSpendableCash - remainingOpenBuyReservations

Reservations include remaining quantity/notional and a defined fee allowance. Release or reduce them exactly once as fills, cancellations, expirations and rejections arrive. Separate unsettled proceeds from immediately spendable cash where required.

Do not universally use cash * multiplier as a broker buying-power model. Track broker-reported buying power with its as-of time and account model. Apply settlement/PDT/GFV restrictions through broker-specific policy; verify current provider rules during implementation rather than embedding assumptions from this plan.

## 7. Reconciliation and recovery

### 7.1 Book readiness

Expose internal states: initializing, ready, recovering, reconciliation_required, unsupported_model and stopped.

Dependent condition evaluation/order sizing must be gated when required accounting or valuation is not ready. Return structured status and reason; do not substitute an empty portfolio or zero cash as if it were a successful query.

### 7.2 Startup/reconnect algorithm

1. Obtain the current owner fence and load calculation version, exact checkpoint, accepted cursor and deduplication/progress data.
2. Buffer arriving events within bounded limits while fetching broker account snapshot, positions, open orders and missing execution history.
3. Apply snapshot/history with provider-defined time/cursor boundaries. Where the API cannot supply an atomic boundary, converge through repeated comparison and retain uncertainty until verified.
4. Rebuild strategy attribution from owned executions and explicit allocation records, not by copying account-wide positions.
5. Replace authoritative snapshot state for its declared scope, including positions absent from a complete snapshot. Absolute broker average/cost must replace or reconcile the prior broker average, not be blended as a new purchase.
6. Replay only events beyond the checkpoint/source boundary and reconcile balances/positions/open-order remaining quantities.
7. Publish ready only after invariants and discrepancy checks pass.

On a gap, missing history or uncertain allocation: retain evidence and pause dependent orders. Do not automatically replay trading nodes or resubmit orders while replaying accounting.

Late fills remain attributed to the owning activation through the existing OrderOwnerRegistry rules. Preserve existing prior-activation handling; do not inject an old activation's fill into the new book.

### 7.3 Durable accounting versus reporting

Current fire-and-forget publication and coalesced reporting snapshots are not sufficient crash-recovery guarantees.

Use one durable accepted-event journal plus exact checkpoint per book. Preferred implementation:
- An acknowledged, idempotent append/accept operation on a durable execution-event store records canonical event identity, decimal payload, book revision and owner fence.
- A pure deterministic replay reconstructs state from checkpoint plus accepted events.
- Checkpoints include the exact accepted journal cursor/revision, order cumulative quantity/notional progress, open cost/fee balances, pending close groups, reservations and necessary deduplication coverage.
- A checkpoint is published durably before earlier journal entries become eligible for retention.
- Reporting fills, trades and UI snapshots are derived consumers. Their failure does not erase an accepted execution.

Redis may implement the journal only if the deployment's persistence, eviction, replication, failover, retention and cluster-slot requirements meet the declared recovery guarantee. Existing cache Redis and a fixed stream MAXLEN do not establish that guarantee. If those conditions cannot be verified, use a transactional durable SQL journal for the lower-frequency execution path; do not add SQL writes to ordinary market-price ticks.

Do not claim lossless provider delivery or exactly-once orders from journal acceptance. Compare against broker execution history after restart/gaps.

### 7.4 Persistence changes and migration boundaries

Before writing a migration, inventory deployed metadata and existing repositories:
- Numeric types/ranges; current uniqueness and RLS; account/environment scoping.
- Whether an existing durable source already provides immutable executions and checkpoints.
- Whether same-identity upserts can overwrite different economic payloads.
- Whether broker execution IDs and source timestamps survive FillEventBus and FillSyncWorker.
- Whether reporting trade IDs remain deterministic after replay; hashing a newly randomized trade ID is not replay-stable identity.

Prefer extending proven existing structures. If no equivalent journal exists, add narrowly scoped internal accounting event/checkpoint storage rather than repurposing coalesced UI snapshots.

Required logical constraints:
- Scoped unique event identity; same identity/different payload becomes an explicit conflict, not an overwrite.
- Unique accepted book revision and checkpoint version.
- User/workflow/activation/account/environment ownership and reference validation.
- Exact numeric representations and original timestamps.
- RLS and grants appropriate to actual callers; internal writes use existing trusted backend paths.
- Database confirmation before acknowledging persistence work.

Preserve the shared reporting tables live_strategies, trades and portfolio from the current repository migration. Do not revert them to historical backtest/live table names. A reporting snapshot ID is a retry identity, not a substitute for accounting journal progress.

FillSyncWorker must reclaim failed/pending entries, iterate reclaim cursors, use stable retry identities and ACK only confirmed writes or an explicitly retained failure disposition. Retention must respect recovery consumers/checkpoints. Review the same guarantees on the source strategy stream; accounting cannot recover executions already lost upstream without broker history.

## 8. Node outputs and downstream consumers

Preserve get_position's positions, has_position, count and deprecated position shape.

Add compatible readiness/source metadata where useful: accounting_status, accounting_revision, calculation_version, account scope, valuation_as_of, reconciliation status and incomplete fee/FX indicators.

Ensure:
- has_position is based on canonical normalized held quantity.
- Position realized/unrealized/total P&L and portfolio totals use documented consistent fee treatment.
- get_cash distinguishes cash from reserved/settled/available funds.
- get_equity and get_portfolio use the same valuation revision.
- Partial exits affect realized accounting immediately.
- Reads do not mutate baselines or return live mutable state references that another caller can accidentally change.
- Lifecycle/algo events with zero executed quantity never create positions, cash flow or fake executions.
- Persisted fill qty and quote_qty are incremental economic values.
- Order history uses final accepted order progress and unique fills; it does not sum cumulative status quantities.
- Grouping and fee totals preserve account/currency scope. Do not sum USD, BNB and ETH commissions into one unlabeled scalar.
- Historical strategy and chart metrics refresh from corrected source contracts instead of compensating through UI-only math.

## 9. Implementation sequence and file map

| Phase | Work | Primary files | Exit condition |
| --- | --- | --- | --- |
| 0 | Freeze current behavior as failing executable regressions; fix outdated test fixtures; inventory templates/schema and account scope | Portfolio tests, orderFillQuantities tests, Portfolio.json, repositories | Each reproduced defect has a failing test; unsupported assumptions documented |
| 1 | Typed event contract; decimal boundaries; explicit quantity/price/fee modes; legacy migration | Proposed portfolio/accounting module; stream adapters; Portfolio.json; templates | Incremental/cumulative paths normalize to identical economic fills |
| 2 | One validated reducer; full-event duplicate protection; correct basis, fees, fractional closures and realized accounting | PortfolioManager.ts; PortfolioExecutor.ts; proposed shared accounting utility; SimBroker/index.ts | Calculation/invariant/property tests pass without external services |
| 3 | Durable event acceptance, ownership fence, checkpoint/replay, broker reconciliation, pending recovery | Existing Redis/accounting infra; FillEventBus.ts; FillSyncWorker.ts; OrderOwnerRegistry; repositories; additive migration if needed | Crash/restart/replay and isolation tests pass; no uncertain book reports ready |
| 4 | Consistent outputs and shared reporting; account-scoped order aggregation; readiness guards | portfolioHelpers.ts; reporting/persistence.ts; SnapshotCache.ts; useLiveOrders.ts; strategy sizing integration | Outputs, ledger and persisted reports reconcile |
| 5 | Safe workflow migration, shadow comparison and staged activation | Workflow validation/configuration and startup paths; plan/runbook | Existing workflows explicitly reviewed; supported accounts match broker evidence |

Avoid separate live/backtest fee fixes that leave permanent calculation drift. A shared helper/reducer can be introduced incrementally while retaining both external adapters.

Do not enable a partially migrated mode in production just because unit arithmetic passes. Each phase may land independently behind a disabled/versioned path; activation requires the relevant recovery and compatibility gates.

## 10. Acceptance test matrix

Implement targeted unit, property and integration checks during implementation. This plan does not add or run production migrations, broker orders or a full integration suite.

| Area | Required scenarios and assertions |
| --- | --- |
| Basic long accounting | Single buy/sell; weighted additions; partial reductions; successive cycles; correct remaining basis |
| Quantity modes | Cumulative 0.3->0.5->1 produces 0.3,0.2,0.5; equivalent incremental events; equal/lower totals; nonzero restored baseline |
| Price modes | Cumulative 1@100->2@105 produces second execution 1@110; native quote notional; missing/contradictory price evidence |
| Duplicate identity | Replayed fill changes no financial field; same ID/different payload conflicts; identical distinct executions both count |
| Ordering/status | Partial/final/cancel sequences; fill after terminal status; status-only event before real fill; gateway generation/sequence reset |
| Fractional precision | 0.3-0.1-0.2 closes exactly; 0.1 roundtrip allocates all entry fees; instrument-valid dust survives; very small/large valid values |
| Fees | Entry+exit fees; partial fee allocation; multiple fee components; cumulative fees; fee-only correction; supported rebate; base-asset and third-asset fees |
| Reproduced P&L | 1@100->1@110 with two fees of 1 gives 8 in cash and net realized; 0.1@100->0.1@110 with those fees gives -1 |
| Fee-in-kind | Broker resulting position already net of fee is not reduced twice; gross execution and net held quantity remain auditable |
| MTM/equity | Only mark fields change; missing/stale FX/marks flagged; no base-asset double count; fee-adjusted peak/drawdown; no invalid denominators |
| Partial-trade visibility | Closing fill updates realized accounting before order completion; reporting aggregation never double-counts it |
| Reservations | Multiple open buys; partial fill then cancel; duplicate cancellation; fee allowance; unsettled proceeds; shared-account allocation authority |
| Scope isolation | Same order/trade IDs in different accounts, environments and symbols; two workflows; late old-activation fill; credential rotation |
| Snapshots | Complete snapshot removes missing positions; authoritative average replacement; account positions do not overwrite strategy attribution |
| Recovery | Crash before durable acceptance; after acceptance/before RAM publication; before/after checkpoint; before reporting ACK; repeated recovery converges |
| Persistence | Same-event retry is idempotent; conflicting immutable payload rejected; pending reclaim; safe retention; stable replay-derived trade identity |
| Compatibility | Missing legacy setting; explicit new modes; imported templates; safe mid-order edit behavior; existing output shapes |
| Invalid/unsupported | Missing IDs, malformed decimals, NaN/infinity, missing baseline, oversell, unsupported margin/futures model; no partial mutation |

Property/invariant checks:
- Reapplying an accepted event is financially idempotent.
- Replay from the same checkpoint and ordered canonical events yields the same state and derived identities.
- Cumulative and incremental representations converge to the same book.
- Net quantity, cash, basis and fees conserve value under supported fee/currency policies.
- Full close leaves no unallocated basis or entry fees.
- Closed-book cash profit reconciles with realized trade profits and explicit external cash events.
- A failed transition leaves the previous published revision unchanged.
- No snapshot/checkpoint may claim a revision whose required journal data is not durable.

## 11. Performance constraints within this correctness work

This is not the separate 1000/2000-node execution project.

Keep mark-to-market, Portfolio reads and ordinary condition evaluation in memory. No per-price-tick database refresh, broker REST request or deduplication query.

Execution normalization/reduction should touch the relevant order, position and currencies. Maintain running totals instead of scanning all historic trades on each read where practical. Bound RAM caches without expiring identities still needed for replay/open orders; archived durable evidence retains deduplication coverage.

Only validated replaceable reporting snapshots may be coalesced. Never coalesce distinct executions, fees, cash movements or corporate actions. Recovery/checkpoint buffers must be bounded with explicit stop/admission behavior.

Measure reducer/normalization CPU, execution-journal admission, snapshot publication and reporting separately. Do not assert speed equivalence to LEAN or a numeric throughput target without representative measurements. Never silently downgrade durable execution acceptance to fire-and-forget to improve timing.

## 12. Rollout, historical repair and definition of done

Rollout:
1. Add contract/regression fixtures and calculation-version metadata.
2. Deploy compatible readers/schema support before new writers.
3. Introduce the corrected path disabled by default and explicitly configure new test workflows.
4. Shadow-replay recorded broker evidence without placing orders. Compare quantities, cash, basis, realized P&L, fees and equity to verified broker views using documented tolerances/as-of times.
5. Reconcile supported paper/test accounts through partial fills, reconnects and restarts.
6. Pause/settle existing activations, checkpoint/reconcile, then explicitly migrate workflow mappings and restart on the new calculation version.
7. Enable supported live configurations in stages with clear discrepancy/recovery diagnostics.

Rollback must preserve accepted journals, exact checkpoints and attribution. Never let an older writer consume a newer calculation version or reinterpret cumulative input as incremental. Disable new starts and retain recovery evidence when compatibility is uncertain.

Historical repair:
- Treat old rows/snapshots as potentially affected; do not multiply/divide balances heuristically.
- Build a dry-run report from broker execution evidence and known opening allocations.
- Separate unknown/unrecoverable periods from verifiable discrepancies.
- Back up affected records and produce proposed corrections with stable source identities.
- Apply corrections only through a separate explicit historical-repair task; this plan authorizes no historical writes.

Definition of done:
- All P01-P06 regressions pass through the real node/accounting path.
- Declared quantity, price and fee semantics are explicit and migration-safe.
- Every supported execution is applied once across the whole book and recoverable after restart.
- Position/cash/trade/reporting values reconcile under documented accounting and currency policies.
- Readiness guards prevent uncertain or unsupported books from driving automatic sizing.
- Tests cover account/activation isolation, fractional fees, duplicate delivery and partial exits.
- Broker reconciliation and durability requirements are verified for the deployed configuration.
- Live and backtest adapters share tested financial rules without conflating simulated fills with broker truth.
- Existing shared reporting and Portfolio output contracts remain compatible or have an explicit versioned migration.
- Futures and other unimplemented models are clearly unsupported instead of producing spot-based financial outputs.

No runtime change is implemented by adding this plan.
