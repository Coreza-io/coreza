

# Fix User-Scoped Redis Key Inconsistencies

## Problem

After changing `runs:data:${runId}` → `user:${userId}:runs:data:${runId}`, the pending list keys and several references were NOT updated consistently. There are also broken variable references (`useId` from React, `userId` undefined in class scope).

## Bugs Found

### File 1: `coreza-backend/src/utils/redisRunStorage.ts`

| Line | Bug | Fix |
|------|-----|-----|
| 74 | `"user:${userId}:runs:pending:all"` — uses **double quotes**, so `${userId}` is a literal string, not interpolated | Change to backticks: `` `user:${userId}:runs:pending:all` `` |
| 75 | Same literal string bug on `ltrim` | Change to backticks |
| 116-118 | `runExistsInRedis` uses `userId` but function signature only takes `runId` — **compile error** | Add `userId: string` parameter |

### File 2: `coreza-backend/src/workers/RunSyncService.ts`

| Line | Bug | Fix |
|------|-----|-----|
| 17 | `import { useId } from "react"` — imports a **React hook** in a backend service. Used on line 124 as `useId` which returns a React client ID, not a user UUID | Remove this import entirely |
| 95 | `"runs:pending:all"` — old global key, doesn't match the user-scoped pattern `user:${userId}:runs:pending:all` | See design decision below |
| 124 | `` `user:${useId}:runs:data:${runId}` `` — `useId` is the React hook import, not a userId string | Use `initiated_by` from the run data, or redesign key lookup |
| 203 | `user:${userId}:runs:data:${run.id}` — `userId` is undefined in class scope | Use `run.initiated_by` |
| 204 | `user:${userId}:runs:pending:all` — `userId` undefined | Use `run.initiated_by` |
| 229 | `user:${userId}:runs:pending:all` in `flushAll()` — `userId` undefined | Redesign approach |
| 245 | `"user:${userId}:runs:pending:all"` — double quotes (literal) + `userId` undefined | Redesign approach |

### Design Decision: Pending List Strategy

The core problem: the pending list was global (`runs:pending:all`), but data keys are now user-scoped. RunSyncService doesn't know which userId to look up when fetching run data.

**Solution**: Store `userId:runId` composite entries in a **global** pending list, then parse both parts during sync.

- Pending list key: `runs:pending:all` (global — RunSyncService needs to iterate all)
- Entry format: `${userId}:${runId}` instead of just `runId`
- On sync, split entry to get both userId and runId for the scoped data key

## Changes

### `redisRunStorage.ts`

1. **Line 74-75**: Fix pending list to use global key with backticks, push composite `${userId}:${runId}`
```typescript
pipeline.lpush(`runs:pending:all`, `${userId}:${runId}`);
pipeline.ltrim(`runs:pending:all`, 0, 9999);
```

2. **Line 116**: Add `userId` parameter to `runExistsInRedis`
```typescript
export async function runExistsInRedis(userId: string, runId: string): Promise<boolean> {
```

### `RunSyncService.ts`

1. **Line 17**: Remove `import { useId } from "react"`

2. **Lines 94-98**: Keep global pending list key `runs:pending:all`

3. **Lines 122-125**: Parse composite entries to extract userId per run
```typescript
for (const entry of pendingRunIds) {
  const [userId, runId] = entry.split(":", 2); // was: entry.split(":")
  fetchPipeline.hgetall(`user:${userId}:runs:data:${runId}`);
}
```

4. **Lines 201-205**: Use `run.initiated_by` for cleanup keys
```typescript
pipeline.del(`user:${run.initiated_by}:runs:data:${run.id}`);
pipeline.lrem(`runs:pending:all`, 1, `${run.initiated_by}:${run.id}`);
```

5. **Lines 227-229** (`flushAll`): Use global list key
```typescript
const count = await redis.llen(`runs:pending:all`);
```

6. **Lines 244-245** (`getStats`): Use global list key with backticks
```typescript
const pendingCount = await redis.llen(`runs:pending:all`);
```

### `workflowWorker.ts`

7. **Line 339**: Already correct — uses `` `user:${userId}:runs:data:${parentRunId}` `` with `userId` in scope.

### Callers of `runExistsInRedis`

8. Find and update all call sites to pass `userId` as first argument.

## Files Changed

| File | Changes |
|---|---|
| `coreza-backend/src/utils/redisRunStorage.ts` | Fix string interpolation, add userId param to runExistsInRedis |
| `coreza-backend/src/workers/RunSyncService.ts` | Remove React import, parse composite entries, fix all undefined userId refs |
| Any callers of `runExistsInRedis` | Add userId argument |

