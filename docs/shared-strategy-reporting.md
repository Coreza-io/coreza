# Shared strategy reporting cutover

`live_strategies`, `portfolio` and `trades` serve both backtests and live activations.
The reporting ID is independent of technical workflow event runs. New live reporting
IDs equal the accepted activation UUID; backtest reporting IDs retain their existing
result UUIDs. Header identity and child scope are checked by SQL triggers, including
service-role writes. Only the backend writes reporting tables; authenticated readers
follow parent ownership through RLS.

Backtests remains the configuration/lifecycle authority. An insert/status trigger
creates and mirrors its reporting header, including failed/cancelled runs without
output. Its final writer updates metrics, upserts finalized trade identities and daily
snapshots, and only then completes the backtest. Live lifecycle uses atomic start
claims and completion, with guarded startup retries and Stopped/Failed terminal
headers. A stop while startup is pending returns a conflict for retry after startup
settles. A failed workflow event does not end an activation. Variable safety stops
retain ownership and source events for the existing approved recovery process.

Snapshots keep exact live timestamps and daily backtest dates. Coalesced Redis keys
include the activation ID, and flush cleanup compares the captured value atomically.
Operational fill streams and unassigned account cash snapshots remain independent.
Trade writes retain failed asynchronous writes for worker/stop retry under the same
finalized-trade identity. None of this adds an order replay/failover guarantee.

The five-second worker refreshes only dirty summaries with compact trade aggregates
and a first/latest equity pair. Full risk metrics use paged history on stop, explicit
Refresh, or the backfill command. Pending finalization is recorded in the header and
recovered after a worker restart. Metrics reuse the portable live formulas, preserve
raw normalization and source currencies, select one account/currency equity series,
and persist non-finite numbers as NULL. An inferred capital baseline is labeled;
legacy lifecycle uncertainty is shown as Unknown. The header does not acquire an
invented capital value. Backtest trade P&L remains currency and holding periods
remain bars, with matching display labels.

## Deployment

This is a coordinated schema cutover, not a rolling-compatible table rename.

1. An operator pauses new starts and affected writers and drains their outstanding
   writes. Do not automatically stop/restart trading as a migration side effect.
   If active writers cannot be quiesced safely, defer this migration and arrange an
   additive catch-up cutover instead.
2. Apply `supabase/migrations/20261028000000_shared_strategy_reporting.sql` once.
   It preserves backtest IDs, copies live source UUIDs, and refuses conflicting
   activation UUIDs or duplicate legacy backtest summaries instead of overwriting
   financial history. Reconcile any reported conflict before retrying the transaction.
   Unscoped live rows remain in the original tables; they are never assigned to a
   current activation. The old live tables remain rollback sources.
3. Deploy the backend and frontend from this same revision. Force affected clients
   to reload before resuming starts/writers. Refresh PostgREST schema metadata (the
   migration emits the reload notification) and retain the realtime publication.
4. With the backend's normal environment configured, run
   `node dist/scripts/backfillStrategyMetrics.js` from `coreza-backend` after the
   normal application build. It pages all missing/pending live summaries and calls
   the same metric helper; rerun after any failure. The running worker also recovers
   missing/pending summaries on startup.
5. Resume writers and starts under the coordinated deployment procedure.

Deleting a workflow cascades its reporting history, matching the existing workflow
permanent-deletion behavior. Stopping/reactivating never deletes that history. Live
links use `/dashboard/live/:workflowId?executionId=...`; omission selects the current
activation or most recent header. Explicit selection never follows another activation.

## Rollback

Pause affected writers first. Reconcile reporting records created after the cutoff
with the old storage before restoring old code/table names. Do not roll back just
the browser or resume old writers against renamed tables. Retain unassigned source
records and preserve timestamp precision and currencies during reconciliation.

No tests or live database changes were performed for this PR, as requested.
