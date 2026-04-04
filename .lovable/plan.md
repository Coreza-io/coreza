

# Updated Plan: Frontend-Generated `runnerInstanceId` + DB Persistence

## Approach

Frontend generates `sessionId` at activation, sends to backend. Backend uses it as `runnerInstanceId` AND saves it to a new `active_session_id` column in the `workflows` table. This gives:
- Instant frontend access (no waiting for first trade)
- Survives page refresh (read from DB)
- Works across tabs/devices
- Clear audit trail of which session is active

## Data Flow

```text
ACTIVATION:
  Frontend (Workflows.tsx):
    1. sessionId = crypto.randomUUID()
    2. localStorage.setItem(`live_session_${workflowId}`, sessionId)  ← instant access
    3. PUT /workflows/:id/schedule { is_active: true, session_id: sessionId }

  Backend:
    route → WorkflowLifecycleService → StreamingLifecycleAdapter
    → WorkflowRunner uses sessionId as runnerInstanceId
    → WorkflowRepository.setActivationState() saves active_session_id to DB

LIVE PAGE (load or refresh):
  useLiveStrategyDetail:
    1. Primary: read workflow.active_session_id from DB (always correct)
    2. Fallback: localStorage (faster on initial render)
    3. Use as run_id filter for all queries + realtime subscriptions

DEACTIVATION:
    Backend: clears active_session_id to null
    Frontend: removes localStorage entry
```

## Changes

### 1. DB Migration
Add `active_session_id UUID` column to `workflows` table (nullable, default null).

### 2. Backend Route: `coreza-backend/src/routes/workflow.ts`
Parse `session_id` from request body in the schedule endpoint, forward to `lifecycleService.setActivationState()`.

### 3. `WorkflowLifecycleService.ts`
- Accept optional `sessionId` in activation input
- Pass to `StreamingLifecycleAdapter.activateStreaming()`
- Pass to `WorkflowRepository.setActivationState()` for DB persistence
- On deactivation: `setActivationState()` clears `active_session_id` to null

### 4. `WorkflowRepository.setActivationState()`
- Add `activeSessionId` param
- Write `active_session_id: isActive ? activeSessionId : null` in the update

### 5. `StreamingLifecycleAdapter.activateStreaming()`
- Accept `sessionId` param
- Pass to `jobQueue.startWorkflowRunner(workflowId, userId, nodes, edges, sessionId)`

### 6. `workflowRunnerManager.ts` → `WorkflowRunner.ts`
- `startStrategy()` accepts optional `sessionId`, forwards to `WorkflowRunner` constructor
- `WorkflowRunner` constructor: `this.runnerInstanceId = sessionId ?? randomUUID()` (use provided ID or fallback)

### 7. Frontend: `src/pages/Workflows.tsx` (or wherever activation is triggered)
- Generate `sessionId = crypto.randomUUID()` before activation API call
- Store in `localStorage.setItem(`live_session_${workflowId}`, sessionId)`
- Send `session_id` in request body
- On deactivation: `localStorage.removeItem(`live_session_${workflowId}`)`

### 8. Frontend: `src/hooks/useLiveStrategyDetail.ts`
- Read `workflow.active_session_id` from the workflow record (DB — survives refresh)
- Use as the `run_id` filter for `live_trades`, `live_fills`, `cash_snapshots` queries
- Use as realtime subscription filter
- Remove the complex session discovery logic (lines 137-178)

## Files Summary

| Layer | File | Change |
|-------|------|--------|
| DB | Migration | Add `active_session_id UUID` to `workflows` |
| Backend | `src/routes/workflow.ts` | Parse + forward `session_id` |
| Backend | `WorkflowLifecycleService.ts` | Accept + forward `sessionId`; pass to repo |
| Backend | `WorkflowRepository.ts` | Store/clear `active_session_id` |
| Backend | `StreamingLifecycleAdapter.ts` | Accept + forward `sessionId` |
| Backend | `workflowRunnerManager.ts` | Accept + forward `sessionId` |
| Backend | `WorkflowRunner.ts` | Use provided `sessionId` as `runnerInstanceId` |
| Frontend | `Workflows.tsx` | Generate + store + send `sessionId` |
| Frontend | `useLiveStrategyDetail.ts` | Read from DB, drop discovery logic |

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Page refresh | Reads `active_session_id` from workflow record in DB |
| Different browser | Same — reads from DB |
| Backend restart | Job queue payload contains `sessionId`, runner reuses it |
| No `session_id` sent (old clients) | `runnerInstanceId = randomUUID()` fallback; DB column stays null; frontend falls back to existing discovery |
| Deactivation | DB column cleared to null; localStorage removed |

