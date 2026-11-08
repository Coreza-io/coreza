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

## Implementation notes

Implementation was subsequently requested. Portfolio now authors the native fill identifier as `brokerExecutionId` (Broker Execution ID). The editor uses `executionId` and `workflowSessionId` for the workflow session without a Portfolio exception. `PortfolioExecutor` maps `params.brokerExecutionId` to the internal `applyOrderEvent().executionId` and uses it for fill-reporting identity; activation context IDs remain separate. Per the subsequent user correction, accepted fills in both cumulative and individual modes use scoped ID membership, recorded after successful accounting. This supersedes the original plan's exemption for cumulative snapshots. The checkbox controls accounting interpretation only; new IDs still use the existing cumulative delta calculations when checked.

Reporting also uses broker ID or sequence independently of cumulative mode. A repeated accepted scoped ID is ignored even if its cumulative totals differ; successive actual fills must therefore have distinct native fill IDs, rather than reusing an order or workflow ID.

Accepted-ID lookup precedes quantity/fee validation, so changed or zero-valued replay amounts cannot prevent `duplicate_execution`. New fills still undergo the existing financial validation; lifecycle-only messages do not reserve execution IDs. Duplicate events retain the existing order-status update path without reapplying financial values.

Any positive applied or reported fill without a native broker ID or positive safe-integer sequence is rejected, including late fills for retired activations. This requirement is independent of Cumulative Fill Values; the checkbox controls accounting interpretation. Cumulative snapshots with no additional quantity and zero-quantity lifecycle messages retain their existing no-fill handling. The Alpaca template maps Broker Execution ID to the normalized `data.order.executionId` (native `execution_id`).

For Binance Spot **individual fills**, uncheck Cumulative Fill Values and map these Portfolio fields (replace the listener name if renamed):

| Portfolio field | Expression |
| --- | --- |
| Broker Execution ID (`brokerExecutionId`) | `{{ $('BinanceStreamListener').json.data.order.executionId }}` |
| Filled Quantity | `{{ $('BinanceStreamListener').json.data.order.filledQty }}` |
| Fill Price | `{{ $('BinanceStreamListener').json.data.order.lastFillPrice }}` |
| Fee Amount | `{{ $('BinanceStreamListener').json.data.order.feeAmount }}` |
| Fee Asset | `{{ $('BinanceStreamListener').json.data.order.feeAsset }}` |

Spot's normalized `executionId` comes from native `executionReport.I`, with native trade ID `t` as fallback. Distinct native IDs therefore remain distinct through the editor request and Portfolio executor; no session UUID substitutes for them. Duplicate identity remains scoped by broker/environment/credential, symbol and order. The bundled templates use the renamed field. Existing saved workflows must move their old Execution ID mapping to Broker Execution ID (`brokerExecutionId`); this change does not edit saved workflow configurations or read the session `executionId` as a fill ID.

When Cumulative Fill Values is checked, supply cumulative quantity, average fill price and cumulative fee totals instead. Binance's per-fill fee must not be mapped as a cumulative fee total. Futures remain unsupported; their listener's `lastFilledPrice` name does not add Portfolio futures support.

Source review only. No tests, builds, lint or runtime validation were run.
