# Portfolio Sync Order Update — configurable cumulative filled quantity

Branch: dev | Scope: plan only, no runtime changes

## Decision
Add a checkbox immediately after **Filled Quantity** in the Portfolio node's Sync Order Update operation: **Cumulative Filled Quantity** (`cumulativeFilledQty`). Checked means the input is the broker's order-to-date cumulative filled quantity; unchecked means the input is the new incremental execution quantity. The broker selector does not determine the semantics: any broker's stream adapter or expression may deliver either form.

## Verified code paths
- `src/nodes/Portfolio.json`: `filledQty` is a text field with description asserting cumulative input.
- `coreza-backend/src/nodes/executors/PortfolioExecutor.ts`: `computeFillDelta` exists but its call and guard are commented out in `sync_order_event`; `filledQty` feeds `pm.applyTrade`, `pm.applyPositionUpdate`, `pm.applyFillAccounting` and `buildFillStreamEvent` (whose `fill_qty_delta` currently receives the same value).
- `coreza-backend/src/simulation/PortfolioManager.ts`: `applyTrade` aggregates exit fills and relies on in-memory positions.
- `src/hooks/useLiveOrders.ts`: `aggregateFillsToOrders` sums persisted row `qty`; it assumes unique incremental executions.
- `coreza-backend/market-stream-service/src/marketGateways/alpaca/helpers.ts`: maps Alpaca `order.filled_qty`, which is order cumulative, to `filledQty`. Alpaca updates may also provide separate per-execution quantity and price.

## UX and compatibility
1. Insert boolean node property directly below `filledQty`, key `cumulativeFilledQty`, label `Cumulative Filled Quantity`, show for `sync_order_event` in broker mode; add tooltip: checked = quantity filled since order creation, unchecked = quantity filled in this event.
2. Use a literal boolean field, not a broker-specific hardcode. Use the existing node-renderer checkbox convention after inspecting other boolean fields.
3. **Migration contract**: existing saved workflows with an absent field must not silently change semantics. Record legacy behavior as `legacy` until explicit migration; current behavior treats values as increments, even though description says cumulative. New nodes may default to true for Alpaca-oriented templates only when template creates explicit setting; otherwise use explicit false and explanatory copy, or prompt user to choose. Update Alpaca template to true explicitly, other known incremental templates to false explicitly. Never infer from broker globally.
4. Changing interpretation for a live workflow requires a new checkpoint/rollover or safe reconciliation; warn/block mid-order toggling.

## Normalization algorithm
- Validate quantities as finite, nonnegative decimals (prefer decimal-safe arithmetic); validate broker order ID, user/workflow/session/account namespace, side, symbol, timestamp, execution ID. Never mix accounts or orders sharing an ID string.
- De-duplicate durable execution ID before applying accounting. Preserve event type, broker native order cumulative qty/avg, and raw IDs.
- Cumulative mode: `delta = max(0, currentCum - previousAcceptedCum)`, but a lower total is **not** blindly accepted as reset: treat as stale/out-of-order/correction, log and reconcile. First event must initialize from a trusted checkpoint/order history, not assume zero for previously live orders. For a completed order, verify against broker final cumulative qty.
- Incremental mode: `delta = inputQty` for each unique execution; never dedupe separate fills merely because their qty/price are the same.
- Zero delta still permits legitimate order-status changes; it must not create a new fill, change cash, or finalize trade twice.
- `avgFillPrice` in cumulative mode may be order-to-date VWAP. Calculate incremental notional `currentCum*currentAvg - prevCum*prevAvg` and delta price `incrementalNotional/delta` where precise enough, or use native per-execution price; reject/flag ambiguous price updates and avoid manufactured P&L.
- Fee semantics may likewise be cumulative vs incremental: inspect provider payload; normalize fees separately, don't blindly subtract/add cumulative fee on every event.
- Persist accepted progress and fill identity atomically or via a durable, idempotent ledger/outbox. Redis cache may accelerate but must not be sole source of truth; handle concurrent workers and restart replay. Do not put Postgres roundtrip on hot market tick path; prioritize durable trade execution event processing.
- Route `delta` into `pm.applyTrade`, `pm.applyPositionUpdate` when no absolute broker `positionQty`, `pm.applyFillAccounting`, and `FillEventBus`. Keep raw cumulative value for `pm.applyOrderUpdate` if it expects absolute order progress; review implementation.
- Respect absolute broker `positionQty` as authoritative reconciliation; never delta-convert it.
- Enforce `finalizedTrade` idempotent persistence; correct all current per-order and trade metrics without UI-only summation hacks.

## Implementation sequence
1. Inspect checkbox node-schema rendering, shared parameter resolution, saved values, operation display options and templates. Update `src/nodes/Portfolio.json`.
2. Create typed normalization contract and tests around existing executor. Avoid an instance-local `Map` as the sole source. Ensure ownership check occurs before mutations.
3. Wire normalized values through order state, trade matching, position update, accounting, event bus, fill storage and downstream aggregations. Audit duplicate and partial status handling.
4. Add persistence/restart/replay guarantees and telemetry: broker, account/session, order ID, exec ID, interpretation mode, raw qty, previous cumulative, delta, skip reason. No secrets in logs.
5. Reconcile historical inflated `live_fills`, `live_trades`, position snapshots, and P&L only with broker evidence; build dry-run and backup before writing. Do not mutate historical records on checkbox rollout automatically.

## Acceptance tests
- Cumulative series 0.3 -> 0.5 -> 1.0 yields deltas 0.3, 0.2, 0.5; recorded order total 1.
- Incremental series 0.3, 0.2, 0.5 also yields total 1.
- Replayed duplicate execution or repeated identical cumulative update produces zero new fills.
- Distinct incremental executions with identical qty/price both count.
- Out-of-order 1.0 then 0.5 does not double count.
- Mixed partial/final status, cancellation, status-only update, missing IDs, zero/null qty and out-of-range qty.
- Accurate VWAP and cumulative-versus-event fee accounting.
- Initial state with previously partially filled order, restart and multiple workers do not inflate quantities.
- Consecutive BUY/SELL cycles yield correct closed trade count, quantities, realized P&L and unique persisted trades.
- Brokerage accounts/workflows cannot cross-contaminate fill state.
- Existing saved workflows behave unchanged pending explicit migration; new Alpaca template selects cumulative.
- Performance overhead measured outside tick hot path; no extra React rendering beyond field.

## Non-goals
Do not alter Alpaca API orders, normalize position symbols globally, or compute dashboard quantities directly from cumulative status events. This is a plan; code not yet implemented.
