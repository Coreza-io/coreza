

# Plan: Frontend-Generated `runnerInstanceId` + DB Persistence (IMPLEMENTED)

## Summary

Frontend generates `sessionId` at activation, sends to backend. Backend uses it as `runnerInstanceId` AND saves it to `active_session_id` column in the `workflows` table.

## Data Flow

```text
ACTIVATION:
  Frontend → sessionId = crypto.randomUUID()
  → localStorage + PUT /schedule { is_active: true, session_id }
  → Backend saves active_session_id to DB
  → WorkflowRunner uses sessionId as runnerInstanceId
  → All trades/fills/snapshots get run_id = sessionId

LIVE PAGE:
  → Reads workflow.active_session_id from DB
  → Falls back to localStorage
  → Uses as run_id filter for all queries

DEACTIVATION:
  → Backend clears active_session_id to null
  → Frontend removes localStorage entry
```

## Files Modified

| File | Change |
|------|--------|
| DB Migration | Added `active_session_id UUID` to `workflows` |
| `schemas.ts` | Added `session_id` to schedule schema |
| `workflow.ts` (route) | Parse + forward `session_id` |
| `WorkflowLifecycleService.ts` | Accept + forward `sessionId` |
| `WorkflowRepository.ts` | Store/clear `active_session_id` |
| `StreamingLifecycleAdapter.ts` | Accept + forward `sessionId` |
| `workflowRunnerManager.ts` | Accept + forward `sessionId` |
| `WorkflowRunner.ts` | Use provided `sessionId` as `runnerInstanceId` |
| `Workflows.tsx` | Generate + store + send `sessionId` |
| `useLiveStrategyDetail.ts` | Read `active_session_id` from DB, removed discovery logic |
