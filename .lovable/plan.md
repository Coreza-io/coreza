

# Fix: No Execution History — Root Cause Analysis & Plan

## Problem
Executions are not appearing in the history panel because runs created by `WorkflowRunner` (streaming) are stored with wrong Redis keys and missing result data.

## Bugs Found

### Bug 1 — Wrong argument order in `createRunInRedis` call (CRITICAL)
**File**: `coreza-backend/src/services/WorkflowRunner.ts`, line 190

Current:
```typescript
await createRunInRedis(executionRunId, this.workflowId, this.userId, { ... });
```
Signature expects: `createRunInRedis(userId, workflowId, runId, snapshot)`

Result: Redis key becomes `user:${executionRunId}:runs:data:${this.userId}` — completely wrong. Pending entry becomes `${executionRunId}:${this.userId}`. RunSyncService can never find or sync these runs to Supabase.

**Fix**: Swap arguments to `createRunInRedis(this.userId, this.workflowId, executionRunId, { ... })`

### Bug 2 — Field name mismatch in `updateRunStatusInRedis`
**File**: `coreza-backend/src/utils/redisRunStorage.ts`, lines 100-106

Current code stores `executionResult.nodeResults` under Redis hash key `nodeResults`. But `RunSyncService` reads `data.result` (line 159) to map to Supabase's `result` column. Field never matches → Supabase gets `result: null`.

Meanwhile, `workflowWorker.ts` passes `{ result }` (line 531) — a different shape entirely.

**Fix**: Normalize `updateRunStatusInRedis` to always store under the `result` key, and serialize the full execution result:

```typescript
if (executionResult !== undefined) {
  // Store full result — handles both { result: ... } from worker
  // and WorkflowExecutionResult from WorkflowRunner
  const resultToStore = executionResult.result ?? executionResult;
  updates.result = JSON.stringify(resultToStore);
}

if (executionResult?.errorMessage) {
  updates.error_message = executionResult.errorMessage;
}
```

### Bug 3 — WorkflowRunner `recordSuccess` passes raw `WorkflowExecutionResult`
**File**: `coreza-backend/src/services/WorkflowRunner.ts`, line 248

Currently passes the entire `WorkflowExecutionResult` object. With Bug 2 fix, this will be handled by the `executionResult.result ?? executionResult` fallback — the full object gets serialized. No separate change needed once Bug 2 is fixed.

## Files Changed

| File | Change |
|---|---|
| `coreza-backend/src/services/WorkflowRunner.ts` | Fix argument order on line 190 |
| `coreza-backend/src/utils/redisRunStorage.ts` | Fix `updateRunStatusInRedis` to store under `result` key consistently |

## Impact
After these fixes, streaming workflow executions will:
1. Store under the correct user-scoped Redis key
2. Appear in the pending list with correct `userId:runId` format
3. Sync to Supabase with the full result payload
4. Show up in the Executions panel with node results and output data

