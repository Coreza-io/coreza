# Coreza Automatic Broker Order Registration — Implementation Plan
Date: 2026-10-24
Target: dev branch only
Status: PLAN ONLY — no runtime changes

## Goal
Automatically register every accepted order submission inside Coreza's internal order ledger without requiring an explicit Portfolio/Register Order node. Broker outputs differ; build broker-specific normalization against verified response forms, preserve existing outputs and streaming behavior, and avoid added broker HTTP requests on the critical path.

## Existing implementation, inspected on dev
- `coreza-backend/src/nodes/executors/BrokerExecutor.ts`: place_order and close_position use idempotency caching; pre-register order ownership where a client idempotency key exists; transform broker HTTP responses, optionally enrich Dhan, post-register order ownership via registered extractor, then update Redis order cache.
- `coreza-backend/src/nodes/executors/PortfolioExecutor.ts`: explicit register_order_intent maps user supplied parameters into PortfolioManager; sync_broker_state registers open orders; sync_order_event handles broker events.
- `coreza-backend/src/simulation/PortfolioManager.ts`: registerOrderIntent constructs a fresh OrderState and unconditionally orders.set(orderId, order) with filledQty=0. This can destroy cumulative fill progress on duplicate registration and race with streaming fills.
- `coreza-backend/src/brokers/capabilities.ts`: broker capabilities and order-owner extractors; optional placeOrderEnrichment.
- `coreza-backend/src/brokers/dhan/capabilities.ts`: get_order_by_id enrichment, up to 3 polls at 400 ms interval. Do not add unconditional HTTP requirements for registration.
- `coreza-backend/src/brokers/schwab/http/operations.ts`: HTTP response transformer extracts orderId from order body or Location header.
- `coreza-backend/src/brokers/binance/http/operations.ts`: spot/futures split, futures algo endpoint, newOrderRespType defaults ACK.
- `coreza-backend/src/brokers/alpaca/http/operations.ts`: POST /v2/orders.
- Existing order ownership and portfolio order ledger are different concerns; do not confuse an owner mapping with a registered order.

## Provider-specific contracts: verify with fixtures and provider docs before coding
| Provider | Placement identity | Order detail shape and special handling |
| --- | --- | --- |
| Alpaca equity/crypto | `id`, `client_order_id` | `symbol`, `side`, `qty` or `notional`, `type`, `time_in_force`, `status`, `filled_qty`, `filled_avg_price`; support fractional/notional and asset pair canonicalization. |
| Binance spot | `orderId`, `clientOrderId` | `symbol`, `side`, `type`, `origQty`, `executedQty`, `status`, `timeInForce`; ACK vs RESULT vs FULL response; fills array if FULL must not double-apply through event stream. |
| Binance futures standard | `orderId`, `clientOrderId` | `origQty`, `executedQty`, `avgPrice`, `reduceOnly`, `positionSide`, `status`; respect futures semantics and account mode. |
| Binance futures algo | `algoId`, `clientAlgoId` where returned | Separate identity domain and status lifecycle; do not pretend algoId is a standard orderId; maintain linkage to child executions and standard orders when available. |
| Schwab | `orderId` from Location header (already transformed in Coreza) | POST may have little/no body; reconstruct symbol, side/instruction, qty, order type and duration from validated request. Multi-leg orders require model support or explicit unsupported/partial-state reconciliation; never assume one leg. |
| Dhan | `orderId` or `order_id` | Some responses only contain ID and status; reuse existing detail enrichment if already enabled, but registration should succeed with authoritative ID and the known submission request; allow later reconciliation with `get_order_by_id`. |

The table is an integration checklist, not a claim that every provider always returns all these fields. Capture sanitized fixtures from each existing transformation and consult current provider API definitions before finalizing schemas.

## Canonical design
Introduce an internal `NormalizedBrokerOrder` (NOT a change to public node output) with:
- identity: provider, environment, credential/account scope, brokerOrderId?, clientOrderId?, algoId?, parentOrderId?, orderKind: standard|algo; workflowId, nodeId, runId.
- submission: symbol, assetClass, side, orderType, timeInForce?, requestedQty?, notional?, limitPrice?, stopPrice?, trail*, submittedAt?.
- lifecycle: status, statusSource, filledQty?, remainingQty?, avgFillPrice?, lastUpdateAt?, lastSequence?, terminal?, broker-native status.
- metadata: native response reference/controlled raw snapshot, normalization completeness, sourceKind (place_response|stream_event|reconcile).
- Use decimal-safe representations for financial quantities/prices (or existing codebase convention); do not silently coerce absent quantity to zero. No `formatVersion` or duplicate `success/status` public fields.
- Choose one identity key scoped by provider + account/credential + environment + broker order identity, never bare orderId globally. For uncertain identity, stage by clientOrderId and reconcile; refuse unsafe guesses.
- Standard vs algo identity keys must be distinct. Composite or multi-leg order structures must be modeled or excluded explicitly with a diagnostic.

## Implementation phases

### Phase 0 — Inventory and behavioral baseline
1. Trace each broker operation from node JSON -> params resolution -> HTTP operation/transformResult -> optional enrichment -> resultSuccess -> order cache -> ownership mapping -> streaming update -> PortfolioManager -> persistent fill ledger.
2. Inspect manual, Execute All, Live, Backtest and AI agent/tool paths. Determine how the exact PortfolioManager instance is obtained for each; do not attach auto-registration to a short-lived manager instance.
3. Capture sanitized sample response and matched request per provider, including failure, partially filled, missing ID, duplicate, timeout, and retry cases.
4. Identify whether close_position, modify_order, cancel_order and simulated backtest fills create lifecycle transitions automatically. Keep normal order placement separate from fill accounting.
5. Baseline performance/latency and any current broker HTTP enrichment. Collect edge-case test matrix.

### Phase 1 — Provider adapters
1. Add `coreza-backend/src/brokers/orderNormalization/types.ts` and `registry.ts`.
2. Put provider-specific parsers alongside broker adapters (`alpaca/orderNormalizer.ts`, `binance/orderNormalizer.ts`, `schwab/orderNormalizer.ts`, `dhan/orderNormalizer.ts`), registered through broker capabilities; no broker name switch cascade in core executor.
3. Normalize HTTP placement and lifecycle event responses separately; preserve raw public node output (existing `$("Buy").json.data` expressions continue working).
4. Interpret broker-specific status enums without inventing fills from status alone. Convert Binance ACK without `status` into an explicitly provisional submission state, not definitive filled/accepted state.
5. For Schwab extract Location in its existing transform, preserve account hash, and guard against multi-leg misclassification.
6. For Dhan use the existing enrichment output when present, otherwise valid ID plus original submission fields.

### Phase 2 — Safe upsert and event ordering
1. Replace unconditional `registerOrderIntent` overwrite with `upsertOrderIntent` or a guarded internal method that only enriches existing state.
2. Preserve filledQty, filledAvgPrice, realized fees, terminal status, previous events, first-created timestamp, and status sequence on duplicate/late submit.
3. Support event-before-HTTP-return, HTTP-before-event, duplicate stream callbacks, retries, and restarts. Registration must never regress terminal orders to pending.
4. Ensure a later broker ID can attach to provisional client-order identity atomically; detect collisions and reject conflicting metadata.
5. Keep fill accounting strictly in existing execution/fill processing. Do not derive incremental fills by naively subtracting a placement snapshot or double apply FULL response fills after stream events.
6. Align `sync_broker_state` with same non-destructive upsert; it currently also calls registerOrderIntent.

### Phase 3 — Automatic lifecycle registration
1. Add `OrderLifecycleService.registerPlacement(normalizedOrder, executionContext)` using the canonical shared PortfolioManager acquisition/lifecycle already used by PortfolioExecutor; support durable account/workflow partitioning.
2. Invoke after successful provider response transform, with existing owner mapping and idempotency cache; preserve pre-registration of owner IDs before broker request to attribute early websocket events.
3. Handle unknown broker outcome (timeout after POST) as UNKNOWN/RECONCILE, not FAILED/SAFE-TO-RETRY. Resolve via client ID/provider lookup before another network placement.
4. If registration fails after placement succeeds, never report 'order not placed'; return preserved broker result and separately emit a critical registration/reconciliation diagnostic. Queue bounded durable repair with idempotency, without sending another order.
5. Avoid any new broker HTTP call, Redis round trip or Postgres write in the low-latency tick critical path unless reliability policy explicitly opts in. Existing order cache/ownership writes remain to be measured and optimized separately.
6. Feature flag `AUTO_REGISTER_BROKER_ORDERS` scoped to execution environment/provider; roll out paper first; emit structured metrics for register succeeded/skipped/reconciled/failed.

### Phase 4 — Stream/reconciliation integration
1. Route normalized broker order updates into one lifecycle upsert path; separate order state transition from fill ledger mutation.
2. Handle partial fills, late fill events, canceled-with-partial-fill, rejected, expired, replaced, algo trigger/child-order creation, and known broker status variants.
3. Reconcile pending unknown placements and stale orders using provider lookup under bounded retry/backoff; do not poll every market tick.
4. Guarantee no cross-user, account, environment, or workflow pollution; ownership routing remains authoritative, with broker identity scoping.
5. Persistence/recovery: verify how ledger survives Live worker restart and fill replay; if PortfolioManager is in-memory, recover from durable order/fill history or explicitly scoped reconciliation before claiming guaranteed durability.

### Phase 5 — UX and compatibility
1. Retain Portfolio/Register Order as an advanced manual/recovery operation, labeled accordingly, until migration is validated. Do NOT silently remove existing workflow nodes.
2. Existing Buy/Sell node data output must remain unchanged; auto-registration is internal.
3. Show order registered/unreconciled indicators in execution diagnostics, not blocking node UI.
4. Allow historical workflow templates with explicit Register Order to run idempotently without resetting fills; detect redundant steps for eventual guided cleanup.
5. No requirement for users to configure repeated Symbol, OrderID, status, quantity expressions in Portfolio node.

### Phase 6 — Tests
- Unit: broker HTTP response fixtures for Alpaca crypto/stock, Binance spot ACK/RESULT/FULL, futures standard/algo, Schwab 201 Location only, Dhan ID only/detail enriched; malformed/partial/canceled/failed.
- State: duplicate place response, duplicate Register Order, fill-before-response, response-before-fill, replay after restart, partial fill then canceled, terminal state cannot revert, broker IDs with collisions across accounts, futures algo IDs.
- Integration: BrokerExecutor to lifecycle service to PortfolioManager; output unchanged and idempotency ownership registry preserved.
- Backtest and Live/manual/Execute All/AI tool pathways; no double order submission, no double fill, consistent queries, no regression to P&L/cash/positions.
- Reconciliation: timeout unknown outcome, registry/storage outage, delayed event, out-of-order sequence, provider detail API unavailable.
- Performance: p50/p95/p99 order-placement added latency and streaming tick overhead; assert no broker HTTP calls added by auto-registration.
- Security: sanitize logs, scoped credentials, reject unrelated workflow order events.

## Recommended files to modify (finalize after Phase 0)
- `coreza-backend/src/brokers/capabilities.ts` and per-broker capabilities files
- New `coreza-backend/src/brokers/orderNormalization/*` and per-broker adapters
- New order lifecycle service under `coreza-backend/src/services/`
- `coreza-backend/src/nodes/executors/BrokerExecutor.ts`
- `coreza-backend/src/simulation/PortfolioManager.ts`
- `coreza-backend/src/nodes/executors/PortfolioExecutor.ts`
- Relevant existing streaming/order/fill processors and automated tests
- `src/nodes/Portfolio.json` only for optional explanatory UI update

## Acceptance criteria
1. Every confirmed successful supported broker order submission becomes a Coreza ledger order automatically, with no Portfolio/Register Order node.
2. Each provider has contract-tested parser, including response-only-ID and futures algo orders.
3. Duplicate or late registration never resets filledQty/status/fees; replay-safe.
4. No simulated cash/position mutation on registration, only on fills.
5. Existing native broker node output and expression references are unchanged.
6. No cross-account/workflow/order ID collisions.
7. A failed registration does not trigger another broker placement and is explicitly repairable.
8. Live/Backtest/Execute All/manual/agent behaviors are verified separately; no tick-path network regression.
9. Existing workflows with Register Order continue correctly, idempotently.
10. Canary rollout to paper/test environments before live enablement.

## Rollout
Phase 0 tests -> adapters -> safe ledger upsert -> one provider Alpaca paper -> Binance Spot -> Binance Futures standard/algo -> Schwab paper -> Dhan sandbox/controlled environment -> live canary per provider. Enable by feature flag; rollback only disables new auto-registration, never deletes ledger.
