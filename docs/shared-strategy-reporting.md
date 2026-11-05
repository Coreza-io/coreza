# Shared strategy reporting

New backtests and live activations report through `live_strategies`, `portfolio`
and `trades`. The schema creates these tables directly. Historical data imports,
table renames, compatibility views and old-payload adapters are outside this change.
Existing database records are not imported or deleted. Backtest lists include runs
with a shared reporting header.

## Identity and lifecycle

A backtest keeps its configuration/lifecycle in `backtests`; a database trigger
creates and mirrors its reporting header. Failed initialization is recorded for both
manual and workflow-owned backtests. A live header uses the accepted activation
UUID as its ID and records pending/running/completed/failed/cancelled lifecycle state.
Child reads use `live_strategy_id`; SQL validates ownership and producer identity.
Stopping/reactivating creates separate reporting history. Permanent workflow deletion
cascades reporting history, matching the existing product behavior.

Activation claims are atomic. A pending startup rejects competing start/stop/delete
requests. Streaming handoff drains the previous scope before registering producers.
Scheduled/webhook execution modes remain unchanged; their portfolio state and
reporting writes use the activation identity. Finalized trades and snapshots receive
retry UUIDs before asynchronous persistence.

Stops serialize cleanup with an activation token. Variable and reporting drains
precede resource destruction. A failed event does not terminate an activation.
A process interrupted during stop retains ownership: verify the old runner is
quiescent before clearing that exact header's stop token and retrying. Variable
safety stops retain their existing approved recovery procedure.

Order ownership retains activation identity for its existing 24-hour TTL. Settled
portfolio state is retained for that window so a delivered late owned fill can
update its original activation without reopening its lifecycle. If state is
unavailable, raw fill attribution is retained and reconciliation is required.
Stopping does not automatically restart listeners or replay orders/events.

## Persistence and metrics

Backtest trades and daily portfolio values use bounded 500-row batches. Live
snapshots retain exact timestamps and raw balances. Coalescing is scoped by
activation/account/currency, with one writer per key and atomic compare/delete
cleanup. Failed writes remain retryable; malformed samples do not block unrelated
activations. Unscoped snapshots use the existing malformed-payload handling.
The legacy `cash_snapshots` table retains historical rows.

Statement triggers mark changed live summaries durably. The worker discovers dirty
headers on its existing cadence; a data revision prevents stale calculations from
hiding newer writes. Full-series calculations read complete paged history on stop
and explicit Refresh. Both readers and writers use the portable live metric helper.
Explicit equity baselines are tied to their account/currency source; absent baselines
are labeled inferred/unavailable. Non-finite metrics persist as NULL. Backtest trade
returns remain currency and holding periods remain bars; Live uses percent and
milliseconds. Display labels respect those units and source currencies.

The existing list/detail components provide Active/History and status filtering.
`/dashboard/live/:workflowId?executionId=...` selects an exact activation; current
navigation selects the current or latest reporting header. Matching totals are paged
and load errors are displayed separately from empty results.

## Deployment

Deploy `20261028000000_shared_strategy_reporting.sql` and the matching backend and
frontend together before starting new reporting runs. Coordinate existing producers
with the operator before switching versions; existing activations are not adopted by
this schema. Reload affected clients and resume starts only after matching code is
available. The migration does not stop or restart trading automatically.

No tests, application execution or live database changes were performed for this PR.
Static type checks retain the existing development-branch diagnostics.
