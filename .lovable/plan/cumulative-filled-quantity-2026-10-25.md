# Coreza implementation plan — Cumulative Filled Quantity
Updated: 25 October 2026
Status: reviewed implementation plan; no runtime changes made.
Repository: Coreza-io/coreza, dev
Reviewed commit: 5d60b66441be0b4c3967238a0d621207d9ed3ef4

## Decision

Keep the requested **Cumulative Filled Quantity** checkbox immediately after Filled Quantity for broker-mode Sync Order Update (`sync_order_event`). Normalize once before applying any accounting. The original proposal is feasible, but needs explicit compatibility, independent price semantics, a single acceptance gate, and an implementable durability boundary.

The checkbox describes the **mapped quantity field**, not the broker. One broker payload can expose both cumulative and individual execution quantities. Do not choose semantics from the broker name.

## 1. Findings from current dev

1. `src/nodes/Portfolio.json` describes Filled Quantity as cumulative and says the executor derives a delta. That description does not match runtime behavior.
2. `PortfolioExecutor.brokerSyncOrderEvent` passes received filledQty and avgFillPrice independently into order updates, trade matching, position changes, cash accounting, and fill persistence.
3. `PortfolioManager.applyOrderUpdate` adds incoming filledQty to the previous total and computes a weighted average as though the input were an individual fill.
4. `applyPositionUpdate` adds signed filledQty unless an absolute positionQty is provided. `applyFillAccounting` uses received qty × price directly.
5. `PortfolioExecutor.computeFillDelta` and its map exist, but its call is commented out. Re-enabling it only for persistence would leave other accounting wrong.
6. `applyTrade` deduplicates execution IDs in a bounded in-memory set. That does not protect orders, positions, balances, or persistence. It can also mark an execution seen before later validation succeeds.
7. Order sequence/status guards return only from applyOrderUpdate. The executor continues other accounting after an order update was rejected.
8. Fill IDs can fall back to a hash containing locally generated event time; replay can therefore create a different ID. LiveTradeRepository inserts closed trades without a stable idempotent trade key.
9. Fill publishing and closed-trade writes are fire-and-forget. A durable quantity watermark alone cannot close the crash gap between accepted state and persisted effects.
10. FillSyncWorker reads new consumer-group messages using `>`; an explicit pending-entry reclaim/retry path is needed. Also preserve its separate algo lifecycle behavior when changing execution-fill identity.

**Compatibility correction:** preserving effective existing behavior means an absent checkbox resolves to **false/incremental**, despite the old cumulative field description. Making missing values true would silently change existing workflows.

## 2. Node UI and configuration contract

| Field | Behavior |
|---|---|
| Filled Quantity | Quantity selected from the source event |
| Cumulative Filled Quantity | Checkbox directly below Filled Quantity; visible only for broker-mode sync_order_event |
| Fill Price Interpretation | Select: Individual execution price / Cumulative average price |
| Average Price | Retain persisted avgFillPrice key; improve help text to explain selected interpretation |
| Execution ID | Existing field; map a real broker execution/trade identity where available |

Quantity help: “Checked: the value is the total filled quantity for this order. Coreza applies only the increase. Unchecked: the value is the quantity of this individual execution.”

Price help: “Cumulative average price is the order VWAP. Coreza derives the cost of newly filled quantity from the change in cumulative notional.”

Configuration:
- Add boolean `cumulativeFilledQty`.
- Add `fillPriceMode: execution | cumulative_average`. Quantity and price are independent; Binance Futures currently illustrates why.
- Newly created Sync Order Update nodes explicitly save cumulativeFilledQty=true and fillPriceMode=cumulative_average. Users mapping individual execution qty/price choose false/execution.
- Existing nodes missing these properties resolve to false/execution. Materialize those legacy values on load/save without changing unrelated graph data, and never let generic schema-default merging replace the missing legacy values with new-node defaults.
- Verify create, load, import, copy/paste, manual execution, backend parameter resolution, live execution and saved execution snapshots.
- Parse resolved booleans explicitly. Accept actual booleans and supported serialized true/false values; absent means legacy false. Reject unresolved templates and invalid values. Never use Boolean("false").
- Keep mode stable for an order after its first accepted fill. A mid-order mode change requires reconciliation, not reinterpretation of old state.
- Correct descriptions of legacy apply_execution/apply_order_update fields separately; those operations are not active switch cases in the reviewed broker executor. Do not imply this change enables them.
- Use the existing generic field renderer. No broker-specific UI branch or new interactive preview is required.

## 3. Broker mappings and required adapter work

These are observations about Coreza's current adapters, not a claim that every broker field has the same meaning.

| Source | Current Coreza mapping | Required configuration/action |
|---|---|---|
| Alpaca trade_updates | filledQty ← order.filled_qty; filledAvgPrice ← order.filled_avg_price; executionId ← data.execution_id | Checked + cumulative_average for those fields. Preserve and expose event qty/price as additive fields for unchecked + execution mapping. |
| Binance Spot executionReport | filledQty ← z; lastFilledQty ← l; filledAvgPrice ← Z/z; lastFillPrice ← L | Checked + cumulative_average for filledQty/VWAP; unchecked + execution for lastFilledQty/lastFillPrice. Prefer Z as exact cumulative quote notional when available. |
| Binance Futures ORDER_TRADE_UPDATE | filledQty ← o.l; cumulativeFilledQty ← o.z; lastFilledPrice ← o.L; filledAvgPrice ← o.ap | Existing filledQty requires unchecked. Pair with lastFilledPrice for execution mode, or explicitly choose cumulative_average with reliable cumulative progress. For checked mode map cumulativeFilledQty. |
| Binance algo lifecycle | Separate algo events carry lifecycle metadata | Preserve separate path; never manufacture fills from lifecycle quantities. |
| Dhan | filledQty ← TradedQty; price falls back AvgTradedPrice → TradedPrice; executionId ← ExchOrderNo | Validate raw fixtures/documentation before fixing mode. ExchOrderNo must not be assumed unique per fill. Split average and execution price provenance; require broker trade identity or cumulative progress. |
| Schwab | filledQty falls back CumulativeQuantity → ExecutionQuantity; price falls back AveragePrice → ExecutionPrice | A fixed checkbox cannot safely interpret a field whose meaning changes by event. Expose separate quantities/prices and provenance; block ambiguous combinations until mapped explicitly. |

Alpaca documentation explicitly distinguishes event qty/price from order cumulative fields:
- https://docs.alpaca.markets/us/docs/websocket-streaming
- https://docs.alpaca.markets/us/docs/activity-sse

The checkbox does not by itself prove the earlier quantity discrepancy's sole root cause. Reproduce the supplied workflow mappings and event sequence, including repeated status messages, before declaring that incident resolved.

## 4. One normalization and application boundary

Introduce a pure `normalizeOrderFill(input, previousCheckpoint)` plus a coordinating `OrderFillApplicationService` (names illustrative). It returns a typed decision:
- accepted fill;
- status-only update;
- duplicate;
- stale observation;
- reconciliation required;
- invalid input.

Normalized fill carries:
- scoped broker order identity, owner and stable event/fill identity;
- source event time and source sequence when reliable;
- deltaQty, deltaNotional, executionPrice;
- cumulativeQty and cumulativeNotional after acceptance;
- fee delta and fee asset, with documented fee semantics;
- quantity/price modes and provenance.

Use precise decimal arithmetic or validated instrument-scale fixed-point arithmetic for quantity, notional, fees and watermark comparison. Do not introduce arbitrary rounding/clamping.

For cumulative quantity:
- Q = current total; Qprev = durably accepted total.
- Q > Qprev: deltaQty = Q − Qprev.
- Q = Qprev: no new quantity; permit independently valid lifecycle updates.
- Q < Qprev: ordinary stale observation; no negative fill and no watermark regression.
- A broker correction/bust is a separate reconciliation/correction path, not an ordinary negative fill.

For incremental quantity:
- deltaQty = incoming quantity only after stable event deduplication.
- cumulativeQty = previous accepted cumulativeQty + deltaQty.
- Equal qty/price/time alone do not establish duplication: two legitimate fills can be identical.
- If neither stable execution identity nor trustworthy cumulative progress exists, return reconciliation_required; do not claim safe incremental replay.
- If both incremental and cumulative fields are available, cross-check them. A mismatch/gap triggers reconciliation; never apply both.

Do not blanket-drop a unique incremental execution because its timestamp is older than the most recent event. Its financial effect may still be missing. Apply through the controlled replay/reconciliation path if chronological trade matching would change.

## 5. Price and fee normalization

Cumulative price requires its matching cumulative quantity or exact cumulative quote notional:
- N = Q × cumulativeAveragePrice (prefer broker cumulative quote notional when available).
- deltaNotional = N − Nprev.
- executionPrice = deltaNotional / deltaQty, only for deltaQty > 0.

Example:
- Qprev=0.3 at VWAP=100 → Nprev=30.
- Q=0.5 at VWAP=104 → N=52.
- New quantity=0.2; new notional=22; incremental price=110.
- Applying 0.2 at 104 would understate cash spent and distort cost basis.

If quantity mode is incremental but price is cumulative_average, obtain cumulative Q from the accepted ledger plus the new execution only when event coverage/order is proven; otherwise require a mapped cumulative total or reconciliation. Missing earlier fills prevent reliable inference.

An individual event price is valid for a cumulative delta only when that event covers the entire delta. If reconnect skipped fills at different prices, one last execution price cannot price the whole missing delta; recover cumulative notional or missing executions.

Validate finite nonnegative quantity; positive price for positive fills; symbol/side/account consistency; and valid notional changes before any mutation. Missing/invalid price must not advance the applied watermark. Equal Q with changed N is a correction, not another fill or an ordinary duplicate.

Quantity mode must not silently determine fee mode. Existing feeAmount remains per-event by default. Handle cumulative fees only with an explicit documented adapter/config contract. Deduplicate fees, retain fee asset and support separately identified late fee adjustments. If cumulative catch-up omits historical per-event fees, mark reconciliation needed instead of inventing fees.

## 6. Apply accepted results consistently

Refactor sync_order_event to call one coordinator before mutating PortfolioManager.

1. Resolve ownership/account identity, validate input, read checkpoint, normalize.
2. Stage one complete application result.
3. Commit it durably using the boundary below.
4. Publish/replace the in-memory projection and emit UI state.
5. Return the existing shared success/error output envelope with concise application diagnostics in data.

Every financial consumer receives the same accepted delta:
- Orders: persist authoritative cumulative quantity/notional; do not add raw cumulative input. Make contract names explicit or supply only delta values to a clearly named delta API.
- Trades: match against the position before the fill changes it.
- Positions: apply signed delta once.
- Cash: use deltaNotional; apply accepted fee once.
- live_fills: persist deltaQty and normalized executionPrice with stable fill identity.
- Closed trades: stable trade identity with idempotent persistence, including terminal finalization.

Keep lifecycle acceptance distinct from fill acceptance:
- A duplicate fill can accompany a new valid terminal status.
- Cancel/expire/reject after partial execution can finalize a pending trade with zero new quantity.
- A terminal lifecycle message carrying old cumulative quantity must not charge cash again.
- A lower-rank status cannot suppress a previously unprocessed valid fill.
- Late fills after cancel require broker-consistent lifecycle reconciliation rather than a blanket status-rank rejection.
- Rejected/stale absolute position snapshots must not overwrite newer positions.

Absolute positionQty is reconciliation data; never add it to deltaQty. Apply the fill first, then reconcile only a fresh valid snapshot. Preserve missing position quantity as undefined: Alpaca currently converts missing position_qty to zero, which can accidentally flatten a position on non-fill events.

## 7. Durable acceptance, concurrency and recovery

**Recommended initial implementation: an awaited SQL transaction per accepted broker order event**, scoped and serialized for the affected portfolio/account. Broker fill events are not the market-data tick loop; keep this work off ordinary ticks and off SimBroker/backtest processing.

The transaction must atomically:
- claim a stable event receipt using a unique scoped key;
- lock/check the order checkpoint and relevant portfolio version;
- validate ownership/fence/version;
- record normalized execution and cumulative checkpoint;
- persist the corresponding recoverable accounting state/deltas, including pending closing-trade state and stable finalized-trade IDs;
- enqueue durable outbox work for downstream projections/publication.

Do not persist only a watermark and asynchronously hope the accounting catches up. A crash after watermark advancement must still leave enough committed state to reconstruct every accounting effect. Publish RAM only after commit; if publication fails, rehydrate from committed state.

Suggested logical records (reuse suitable existing schema after inspection):
- immutable accepted event/execution ledger and receipts;
- order fill checkpoints (quantity, notional, modes, lifecycle freshness/version);
- versioned portfolio recovery state, including pending trade aggregation;
- durable outbox with idempotent consumers.

Scope identity by user, broker, stable broker account, environment and broker order ID; include instrument/leg where broker IDs require it. Use stable account identity rather than a credential secret or a credential ID that changes on rotation. Keep workflow ownership explicit; run/execution ID is attribution, not the only replay-deduplication key. Reject competing ownership rather than letting two workflows book the same account execution.

Serialize all affected portfolio mutations, including different orders for one symbol and balance/position reconciliation. Per-order locks alone do not protect shared cash and positions. In-process queues are insufficient across workers; use database versioning/locking and ownership fencing.

Recovery must finish before consuming new source events:
- restore portfolio checkpoint, order progress, fee state and pending trade state;
- replay committed events after checkpoint in a defined order;
- resume outbox delivery with deterministic IDs;
- reclaim pending Redis entries and retry; acknowledge only after durable sink success;
- prevent stream retention from trimming the only recoverable unprocessed copy.

Keep the existing FillSyncWorker as an idempotent projection where practical. It must not duplicate SQL-owned accounting or coalesce multiple ordinary fills into one algo key. Update live_fills uniqueness for account/environment scope, preserve execution identity, and make closed-trade projection an upsert under a stable trade key.

Deployment must inspect existing schema, grants/RLS and repository queries before generating migrations. No production data/schema changes are part of this planning task.

If later latency measurements justify a Redis-first design, treat that as a separate implementation phase requiring atomic ledger+checkpoint+outbox persistence, verified durability, recovery and ownership fencing. Cache Redis plus fire-and-forget XADD is not a substitute.

## 8. Migration and rollout

1. Add schema/service recovery foundations and idempotent projections first.
2. Add backend normalization, then explicit UI authoring defaults.
3. Keep existing nodes false/execution unless explicitly migrated. Display their effective mode accurately.
4. Audit existing Alpaca/Spot/Futures mappings. Legacy compatibility preserves old behavior, including potentially incorrect mappings; document affected workflows rather than claiming all legacy data is repaired.
5. Before enabling a new accounting path, establish an authoritative portfolio baseline and per-order checkpoint at a controlled ingestion boundary. Never assume an existing partly filled order starts at zero.
6. For old fills lacking trustworthy identities/checkpoints, reconcile against broker executions and balances. A position snapshot alone cannot reconstruct cash, fees and realized P&L.
7. Enable with fixture replay and paper trading. During comparison, shadow calculations must not mutate or write accounting.
8. On rollback, pause affected ingestion and retain committed ledger/checkpoints. Do not replay the same accepted fills through the legacy path.
9. Historical incorrect trades/positions require a separate reviewed repair/rebuild; do not automatically rewrite financial history.

## 9. Implementation files

| Existing area | Change |
|---|---|
| src/nodes/Portfolio.json | Checkbox, price mode, accurate conditional help/defaults |
| Node initialization/import/hydration/parameter resolution | Discover exact callers; distinguish new defaults from absent legacy fields |
| coreza-backend/src/nodes/executors/PortfolioExecutor.ts | Resolve modes; replace independent mutations with coordinator; remove obsolete delta map |
| coreza-backend/src/simulation/PortfolioManager.ts | Explicit delta/cumulative contracts; staged application; shared acceptance; recoverable trade state |
| market-stream-service/src/marketGateways/{alpaca,binance,dhan,schwab}/helpers.ts | Preserve missing values; separate source quantities/prices and identity provenance |
| Associated event types/listener output shaping | Carry additive fields end-to-end without renaming current workflow paths |
| FillEventBus.ts / FillSyncWorker.ts | Durable outbox integration, stable IDs, pending recovery and projection idempotency |
| LiveFillRepository.ts / LiveTradeRepository.ts | Account-scoped uniqueness and deterministic fill/trade upserts |
| New normalization/application/recovery services | Pure normalization, transaction boundary, replay and controlled reconciliation |
| supabase/migrations and repository tests | Reviewed ledger/checkpoint/outbox changes, policies and migration verification |

Coordinate with .lovable/plan/automatic-broker-order-registration-2026-10-24.md: order ownership/registration and fill acceptance must share identity and must not book initial fills twice. This checkbox plan does not automatically implement order registration.

## 10. Acceptance tests

| Scenario | Expected result |
|---|---|
| Checked: 0.3 → 0.5 → 1 | Applied quantities 0.3, 0.2, 0.5; order total 1 |
| Unchecked: 0.3, 0.2, 0.5 with unique execution IDs | Same final position, cash and order total |
| Exact duplicate replay at every partial stage | No extra quantity, cash, fees, fills or trades |
| Two unique executions with identical qty/price/time | Both booked once |
| Cumulative 0.5 → 0.3 → 1 | Lower observation changes no financial state; total applied remains 1 |
| Cumulative 1 → filled status at Q=1 | Status progresses; zero new accounting |
| Partial close → canceled/expired at unchanged Q | Pending close finalized once at actual executed quantity |
| Changing cumulative VWAP | Correct deltaNotional/price and realized P&L |
| Missing execution between cumulative observations | Quantity/notional catch-up correct; missing fees identified |
| Invalid price → corrected retry | No premature receipt/watermark loss; valid event subsequently applies |
| Equal Q, changed cumulative notional | Explicit correction/reconciliation result |
| Missing Alpaca position_qty | Does not flatten position |
| Replayed/stale position snapshot | Does not overwrite newer financial state |
| Late unique execution or fill after cancel | Accepted/reconciled without status regression or lost accounting |
| Concurrent events from two workers / two orders same symbol | One consistent portfolio; no double spend or lost update |
| Crash before transaction commit | No accepted accounting; safe retry |
| Crash after commit before RAM/UI/outbox delivery | Rehydrate committed result; no duplication |
| Worker crash before/after sink write and ACK | Pending reclaim; idempotent fill and closed-trade rows |
| Same broker order ID in different accounts/environments | Fully isolated state and identities |
| Run restart/credential rotation | No loss of identity or old-fill replay |
| Legacy node load/save/import/copy | Missing modes remain false/execution |
| New node save/reopen/manual/live | Explicit modes preserved and respected |
| Mode changed mid-order / missing baseline | Reconciliation required; no reinterpretation |
| Binance algo lifecycle / SimBroker regression | Existing behavior preserved; no synthetic fills |

Test long, short, partial exit and position flip, fractional precision, quote/base/third-asset fees, and both price modes. Verify Orders, Trades, Portfolio, cash/equity and persisted rows agree after each event and restart.

Extend existing portfolioTradeAggregation.test.ts, portfolioExecutorAlgoLifecycle.test.ts and binanceOrderUpdateNormalization.test.ts; add targeted normalization, persistence fault-injection and replay integration tests. Run relevant frontend/backend type checks and builds. No claim of runtime correctness until those checks and paper-trading replay pass.

## Completion criteria

The feature is complete when one accepted fill has one consistent effect across order progress, positions, cash, fees, trades and persistence; duplicates/restarts preserve that result; source mappings explicitly express quantity and price semantics; and existing saved workflows retain their declared compatibility behavior.
