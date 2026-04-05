
Final resolution after end-to-end review:

1. Primary root cause: backend runner is not being replaced between live sessions
- `coreza-backend/src/workflow/WorkflowLifecycleService.ts`
  - deactivation calls `streaming.deactivateStreaming(...)`
  - but it never stops the in-memory `WorkflowRunner`
- `coreza-backend/src/workflow/StreamingLifecycleAdapter.ts`
  - `deactivateStreaming()` unregisters stream subscriptions only
  - it does not call `jobQueue.stopWorkflowRunner(workflowId)`
- `coreza-backend/src/services/workflowRunnerManager.ts`
  - `startStrategy()` returns early if a runner already exists for that workflow
- Result:
  - old runner stays alive with old `runnerInstanceId`
  - new activation writes new `workflows.active_session_id`
  - frontend queries new session
  - backend still persists trades/fills/snapshots under old session
  - live page shows zero data for the new session

2. Secondary root cause: activation flows are inconsistent
- `src/pages/WorkflowEditor.tsx`
  - activates via `/workflows/${workflowId}/schedule`
  - but does not send `session_id`
  - also performs a redundant direct Supabase update
- `src/pages/Workflows.tsx`
  - generates `sessionId` and dispatches the session event
  - but calls the wrong endpoint: `/workflows/${user?.id}/${workflowId}/schedule`
- Result:
  - some activation paths create no `active_session_id`
  - some paths may fail or bypass the intended session lifecycle
  - frontend/live page behavior becomes inconsistent

3. Tertiary root cause: live hook fallback is too permissive for active workflows
- `src/hooks/useLiveStrategyDetail.ts`
  - current resolution is `pending ?? db ?? localStorage`
  - for active workflows, localStorage should not be used as a general fallback
- Result:
  - stale session IDs can leak into a new run
  - or the hook can stay disconnected from the real backend session state

Best implementation approach:

A. Fix backend session lifecycle first
- In `StreamingLifecycleAdapter.deactivateStreaming()` or `WorkflowLifecycleService.deactivate()`, explicitly stop the workflow runner on deactivation.
- Also harden `WorkflowRunnerManager.startStrategy()`:
  - if an existing runner is found for the same workflow and its session differs from the requested session, stop it and create a fresh runner
  - only no-op when the session is exactly the same
- This is the key fix. Without it, frontend changes alone will never work reliably.

B. Unify activation logic into one shared frontend flow
Create one shared activation helper/hook used by both:
- `src/pages/Workflows.tsx`
- `src/pages/WorkflowEditor.tsx`

That shared flow should:
- generate `sessionId` on activation
- call the correct backend route: `/workflows/${workflowId}/schedule`
- send `{ is_active, session_id }`
- store `live_session_${workflowId}` in localStorage on activation
- dispatch `coreza-live-session-updated`
- rollback localStorage + dispatch previous session on API failure
- remove the redundant direct Supabase `.update({ is_active })` path from the editor/list pages

C. Tighten session selection in `useLiveStrategyDetail`
Change resolution rules to:
```text
if pending session exists:
  use pending
else if DB active_session_id exists:
  use DB session
else if workflow is inactive:
  use preserved DB/local last session
else:
  no session yet -> show cleared state and wait
```

Important change:
- do not use localStorage as fallback for an active workflow unless it is the current pending activation session
- this prevents stale-session reuse

D. Make the live page react to workflow session changes directly
In `useLiveStrategyDetail.ts`, add a realtime listener on `workflows` for that workflow’s row:
- react to changes in `is_active`
- react to changes in `active_session_id`
- immediately refetch/reset when the backend confirms the new session

This removes dependence on only the custom browser event and makes refresh/multi-page flows reliable.

Where live data is actually populated today:
- `workflows.active_session_id`
  - set in `WorkflowLifecycleService.activate()` -> `WorkflowRepository.setActivationState(...)`
- `workflow_runs.session_id`
  - set in `WorkflowRunner.processMessage()` -> `createRunInRedis(..., this.runnerInstanceId)` -> `RunSyncService`
- `live_trades.run_id`
  - `coreza-backend/src/nodes/executors/PortfolioExecutor.ts`
  - `LiveTradeRepository.insert({ run_id: context.runId, ... })`
- `live_fills.run_id`
  - `PortfolioExecutor` builds fill events with `run_id: context.runId`
  - `FillSyncWorker` writes them to `live_fills`
- `cash_snapshots.run_id`
  - `PortfolioExecutor` builds snapshot with `run_id: context.runId`
  - `SnapshotCache.upsertLatest()` stores it
  - `FillSyncWorker.flushSnapshots()` inserts into `cash_snapshots`

Critical technical insight:
- In live mode, `context.runId` is the session-level runner ID, not the per-tick execution ID
- That is correct for dashboard filtering
- So if metrics are empty, the usual cause is not the table mapping; it is session mismatch between:
  - frontend `active_session_id`
  - backend runner `runnerInstanceId`

Implementation order:
1. Stop/restart runner correctly on deactivate/reactivate
2. Unify frontend activation logic across Workflows + WorkflowEditor
3. Tighten `useLiveStrategyDetail` session resolution
4. Add `workflows` realtime subscription
5. Remove redundant frontend direct DB updates

Expected behavior after fix:
```text
Inactive workflow:
  show last preserved session data

Activate new run:
  frontend generates new sessionId
  UI clears immediately
  backend starts a fresh runner with that same sessionId
  new trades/fills/snapshots are written with that sessionId
  live metrics populate only from the new session

Deactivate:
  runner stops
  last session remains viewable
```

Verification checklist:
- Activate from Workflows page -> new session appears, metrics start updating
- Activate from WorkflowEditor -> same behavior
- Deactivate -> last session remains visible
- Reactivate -> UI clears immediately, old data does not append
- Confirm DB alignment:
  - `workflows.active_session_id`
  - `live_trades.run_id`
  - `live_fills.run_id`
  - `cash_snapshots.run_id`
  - `workflow_runs.session_id`
  all match for the active session
