# Automatic live results refresh

The live results page now updates without the manual Refresh action. Existing
scoped Realtime subscriptions are retained, with a 250ms burst throttle, and a
read-only reconciliation runs every 15 seconds while the page is visible and
the browser is online. Subscription/reconnection, focus, restored connectivity
and returning to the tab schedule a reconciliation too.

The existing scoped loader permits one flight and at most one queued reload.
User/workflow/execution changes reject stale responses. A selected run is
published only with its successfully loaded children. Explicit historical
execution selection remains pinned; the current view can discover a new activation.
Subscriptions, listeners and timers are cleaned up on scope change/unmount.

Temporary background failures retain the last successful chart, viewport, metrics
and run header, with a retry status. Last checked means the last successful read,
not the timestamp of the latest equity observation. Initial failures still show
an error and automatically retry. Background loads do not replace the header
with a loading skeleton. The chart is not remounted for same-run updates.

Only reporting reads are automated. The previous manual authenticated reporting
refresh POST is removed from this page; no broker queries, workflow starts,
order replay or polling-triggered metric writes occur. The backend already flushes
saved snapshots and refreshes dirty reporting metrics periodically. A chart with
no snapshots shows a waiting message; refreshing cannot manufacture missing equity.

Read-only inspection found live_strategies, portfolio, trades and workflows in
the connected Realtime publication, but not live_fills. The fallback read handles
that missing event source without requiring a database migration. The screenshot's
workflow ID did not match a reporting header in the connected project, so this
review does not claim to have diagnosed that specific run's missing snapshots.

The existing complete-history pagination and source/currency normalization remain
unchanged. Larger histories may warrant an incremental reporting reader in a
separate change; this patch introduces no silent history cap.

No tests or browser checks were run, following the user's no-testing instruction.
Frontend type-check results are recorded in the PR. Before rollout, verify visible
updates on new snapshots/fills, reconnect/focus/online recovery, burst coalescing,
offline/hidden-tab suspension, failure recovery, pinned-history isolation and
Strict Mode cleanup. No production data or schema was changed during this work.
