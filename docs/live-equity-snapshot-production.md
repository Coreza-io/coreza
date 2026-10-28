# Live equity snapshot production

Frontend auto-refresh (#875) reconciles persisted reporting rows. A successful
broker request or a saved trade does not by itself supply portfolio-equity
observations. The portfolio executor previously queued snapshots only in its
order-event path; creation, account synchronization and mark-to-market returned
updated state without queuing an equity snapshot.

This follow-up queues existing coalesced reporting snapshots after:

- Portfolio creation with an explicit capital observation, after positions and
  baseline initialization are complete. Missing values are not promoted to a
  fictitious zero-equity observation.
- Successful Alpaca account/position/order synchronization, using the account
  currency already returned by the broker.
- Successful mark-to-market updates on an initialized portfolio.

Only live-owned invocations (live mode or reportingExecutionId) with user,
workflow and execution identity participate. Ordinary manual and backtest paths
do not gain persistent reporting snapshots. The existing fill snapshot path is
retained. Snapshot errors are isolated from the completed portfolio operation so
they cannot turn reporting failure into a trading retry.

The existing SnapshotCache -> FillSyncWorker -> portfolio reporting pipeline
coalesces and persists observations; Realtime/fallback readers then display them.
No extra broker API calls, order/fill changes, account polling, migrations or
historical backfill are added. Unused trade analytics work was removed from the
snapshot builder; snapshot values retain the existing portfolio valuation basis.

Run the updated frontend and backend together. The old Refresh button in the
provided screenshots predates #875; the updated frontend shows automatic-update
status instead. Restarting only the backend cannot update a stale frontend build.
Confirm both processes use the same intended Supabase project. The screenshot's
workflow is absent from the connected project, so its exact source configuration
and snapshot history could not be verified here. A broker-only workflow still
needs portfolio initialization and valuation updates; broker success logs alone
are not evidence of a persisted equity observation.

No tests, broker requests, deployments or database mutations were performed.
Source/type review only. Validate initial sync/creation produces a first point,
subsequent valuation updates produce new observations, stopped/manual/backtest
ownership remains isolated, persistence errors retain recovery behavior, and the
current frontend receives saved points automatically in the intended environment.
