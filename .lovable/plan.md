

# Review: execution_id Rename Changes

## Status: Almost Complete

The DB migration and all runtime code (repositories, services, workers, frontend hooks) are correctly updated. Two backend type definition files are stale.

## What's Correct

| File | Status |
|------|--------|
| DB migration (5 ALTER TABLE statements) | Done |
| `WorkflowRepository.ts` | Uses `active_execution_id` |
| `LiveTradeRepository.ts` | Uses `execution_id` |
| `LiveFillRepository.ts` | Uses `execution_id` + `broker_execution_id` |
| `CashSnapshotRepository.ts` | Uses `execution_id` |
| `FillEventBus.ts` | Uses `execution_id` + `broker_execution_id` |
| `SnapshotCache.ts` | Uses `execution_id` |
| `FillSyncWorker.ts` | Maps `execution_id` + `broker_execution_id` correctly |
| `PortfolioExecutor.ts` | Uses `context.executionId` for all live persistence paths |
| `useLiveStrategyDetail.ts` | Queries by `execution_id`, reads `active_execution_id` |
| `market-stream-service/types/supabase.ts` | `workflow_runs` has `execution_id` |

## Issues Found

### 1. `coreza-backend/src/types/supabase.ts` — Missing fields

The `workflow_runs` type is missing `execution_id` in Row/Insert/Update. The `workflows` type is missing `active_execution_id`. These types are used by backend code (e.g., `RunSyncService`) and will cause TypeScript compilation errors if strict typing is enabled.

**Fix**: Add `execution_id: string | null` to `workflow_runs` Row/Insert/Update, and add `active_execution_id: string | null` to `workflows` Row/Insert/Update.

### 2. `market-stream-service/types/supabase.ts` — Missing `active_execution_id` on workflows

The `workflows` type here is also missing `active_execution_id`.

**Fix**: Add `active_execution_id: string | null` to `workflows` Row/Insert/Update.

### 3. No other issues

- No stale `session_id` or `run_id` references remain in backend code
- No stale `active_session_id` references remain anywhere
- Frontend correctly uses `as any` casting to bypass auto-generated types (which will self-heal on next type regeneration)
- `PortfolioExecutor` correctly passes `context.executionId` (session-level) to all persistence calls and `params.executionId` (broker-level) to `broker_execution_id`

## Implementation

Two type files need updating — straightforward field additions to match the DB schema.

