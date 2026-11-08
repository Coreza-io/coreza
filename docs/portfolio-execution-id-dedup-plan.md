# Plan: Execution-ID-only deduplication for Portfolio Sync Order Update

## Goal
Fix `Conflicting execution identity` for successive partial fills in Portfolio → Sync Order Update. Use a broker fill's execution identifier as the sole duplicate criterion, without comparing quantity, price, fee, or cumulative mode fingerprints. Keep changes minimal and preserve existing financial accounting and order-progress handling.

## Confirmed cause / important constraint
A debugger showed two valid Binance Spot fills for the same order (0.3336 and 0.6664 ETH), but `PortfolioManager.applyOrderEvent()` received the same UUID-like `input.executionId` for both, although the Binance listener exposes numeric fill execution IDs. Removing the fingerprint check *alone* would silently discard the second fill. Correct the broker execution ID propagation before relying on ID-only duplicate handling.

## Proposed changes (dev)

1. **Use the broker's fill execution ID end-to-end**
   - Trace the Portfolio node's `executionId` field from its resolved expression through `PortfolioExecutor.brokerSyncOrderEvent()` to `PortfolioManager.applyOrderEvent()`.
   - Keep the workflow/activation `context.executionId` separate from the fill's broker execution ID. Avoid overwriting `params.executionId` with the workflow UUID.
   - In the Binance Spot workflow, map the Portfolio execution ID to `BinanceStreamListener.data.order.executionId` (or its actual broker trade ID if that is the stable unique *trade-fill* identifier for the payload). Do not use a run/session ID. Confirm the two partial fills pass distinct native IDs.
   - Preserve broker/account, symbol and order scope for namespacing; an execution identifier alone need not be globally unique across brokers/accounts.
   - Do not alter the Stream Listener's public response shape unnecessarily.

2. **Simplify accepted-fill dedup in `PortfolioManager.ts`**
   - Replace the `acceptedFills: Map<string,string>` fingerprint store with a `Set<string>` (or equivalently use map key existence only); retain the existing scoped `identity` construction using native execution ID, with sequence fallback where applicable.
   - For non-cumulative economic execution events: if the scoped identity was accepted before, return existing `duplicate_execution` no-op behavior, regardless of incoming quantity/price/fee. Otherwise validate and apply the fill, then record its identity only after the successful accounting transition.
   - Remove the `Conflicting execution identity` comparison/throw. Do not silently merge a second distinct fill just because it shares an order ID.
   - Preserve the current accepted-ID capacity limit and activation lifecycle cleanup. Keep `normalizeFill` and cumulative progress logic unchanged.
   - Remove the now-unused `fillFingerprint` import/function only if there are no other call sites.

3. **Preserve event semantics**
   - For individual fills (Cumulative Fill Values unchecked): map `filledQty`, execution-specific price (`lastFillPrice` for Binance Spot; `lastFilledPrice` for Futures), per-fill fee and a stable broker execution ID.
   - For cumulative snapshots (checkbox checked): keep the existing quantity/average-price/fee-total delta method, not execution-ID-only filtering; cumulative updates may repeat an event ID while order progress changes.
   - Do not change position accounting, cash calculation, order status handling, or add futures support as part of this fix.

## Scope
Likely files: `coreza-backend/src/simulation/PortfolioManager.ts`, `coreza-backend/src/nodes/executors/PortfolioExecutor.ts` only if the ID is overwritten there, and narrowly scoped Binance workflow mapping/documentation if needed. Avoid refactors, new database tables, migrations, and unrelated changes.

## Acceptance criteria (source review only; do not run tests)
- Distinct broker fill execution IDs for one order are each accepted once.
- Repeated scoped execution ID is ignored as a duplicate even if its financial fields differ.
- Workflow activation UUID never substitutes for the broker fill execution ID.
- Cumulative snapshots continue to use order-progress deltas.
- Existing financial validation and post-acceptance identity recording remain intact.

## Constraints
**Plan only. No implementation, tests, builds, lint, or other validation runs requested.**
