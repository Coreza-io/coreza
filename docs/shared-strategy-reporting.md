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
include the activation ID and account/currency source, and flush cleanup compares the captured value atomically.
Operational fill streams and unassigned account cash snapshots remain independent.
Trade writes retain failed asynchronous writes for worker/stop retry under the same
finalized-trade identity. None of this adds an order replay/failover guarantee.

The five-second worker refreshes only dirty summaries with compact trade aggregates
and a first/latest equity pair. Full risk metrics use paged history on stop, explicit
Refresh, or the backfill command. Pending refresh/finalization and a data revision are recorded in the header. The
worker discovers dirty summaries on every cadence, including writes from other
processes; a version guard prevents a stale refresh from hiding newer data. Metrics reuse the portable live formulas, preserve
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

## End-to-end review corrections

The PR review traced admission, execution producers, finalized trades, cache drains,
SQL writes, summary refresh and both reporting screens. It corrected these gaps:

- Scheduled/webhook events keep their technical execution mode while their
  PortfolioManager state uses the accepted activation ID. Live finalized trades
  receive UUIDs before asynchronous persistence instead of restarting a local counter.
- Snapshot retries upsert the sample UUID. Separate source samples with an identical
  timestamp survive migration; account/currency sources do not overwrite one another
  in the cache. Cache retries retain one coalesced writer per key. A malformed sample
  remains available for recovery without blocking unrelated activations.
- SQL statement triggers mark affected live headers dirty after child inserts or
  updates. Cross-process summary refresh uses a captured data revision; status and
  newer reporting data win over an older calculation. Full history remains paged.
- Stop claims serialize competing cleanup requests for the same activation. Resource
  destruction follows the targeted reporting drain and variable-ownership drain.
  If a process dies while holding a stop token, the operator must verify that the
  old runner is quiescent before clearing that exact header's stop token and retrying.
  This does not authorize automatic order failover or source-event replay.
- Explicit creation equity (or explicit cash with no initial positions) is recorded
  as a capital baseline tied to its account/currency source. Missing baselines remain
  labeled inferred/unavailable; later sources cannot replace the chosen baseline.
- Broker order-owner metadata retains the reporting activation ID across a normal
  stop for its existing 24-hour TTL. Settled portfolio state is retained for that same
  bounded period so a delivered late owned fill uses the previous activation. If
  that state is unavailable (including after a process restart), the raw fill is
  retained under the known old ID and reconciliation is required; a fresh zero-equity
  portfolio is not invented. Stopping does not restart a listener to consume fills.
- Stop/finalization resolves the durable activation header independently of the
  workflow's currently edited graph, so removing a broker node cannot strand a run.
- Reliable scoped legacy trades/snapshots are copied even if the workflow's current
  graph no longer contains a broker portfolio. Run-only evidence uses its captured
  graph, and unknown lifecycle values remain labeled Unknown.
- Backtest trade writes retain the existing 500-row batching, list/dashboard totals
  page through all matching rows, and live net profit retains snapshot realized-P&L
  precedence through the shared metric helper.

Review validation remains static only: no test suite, application run, database
migration or live query was executed. Deployment still requires the coordinated
cutover above; the migration must not be applied underneath old running writers.
