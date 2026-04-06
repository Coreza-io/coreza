

# Plan: Rename `active_session_id` and Align `execution_id` Across DB and Code

## Summary

Rename the DB column `workflows.active_session_id` to `active_execution_id`, add `execution_id` column to `workflow_runs`, and rename `run_id` to `execution_id` in `live_trades`, `live_fills`, `cash_snapshots` (since that field stores the session/instance-level ID, not the per-tick `runId`).

**Note**: `live_fills.execution_id` already exists but stores the **broker execution ID** (Alpaca/Binance fill execution ID). This is NOT the same as our workflow `execution_id`. We must keep both — rename our session-scoped field from `run_id` → `execution_id` and rename the broker field to `broker_execution_id` to avoid confusion.

---

## Database Migrations

### Migration 1: `workflows` table
```sql
ALTER TABLE public.workflows RENAME COLUMN active_session_id TO active_execution_id;
```

### Migration 2: `workflow_runs` table
```sql
ALTER TABLE public.workflow_runs
  ADD COLUMN IF NOT EXISTS execution_id text;

ALTER TABLE public.workflow_runs RENAME COLUMN session_id TO execution_id;
-- If session_id and execution_id would conflict, drop session_id after migrating data:
-- UPDATE workflow_runs SET execution_id = session_id WHERE execution_id IS NULL AND session_id IS NOT NULL;
-- ALTER TABLE workflow_runs DROP COLUMN session_id;
```

Actually, since `workflow_runs` already has `session_id` and we want `execution_id` instead:
```sql
ALTER TABLE public.workflow_runs RENAME COLUMN session_id TO execution_id;
```

### Migration 3: `live_trades` table
```sql
ALTER TABLE public.live_trades RENAME COLUMN run_id TO execution_id;
```

### Migration 4: `live_fills` table
```sql
-- Rename broker execution_id to avoid conflict
ALTER TABLE public.live_fills RENAME COLUMN execution_id TO broker_execution_id;
-- Rename our session-scoped run_id to execution_id
ALTER TABLE public.live_fills RENAME COLUMN run_id TO execution_id;
```

### Migration 5: `cash_snapshots` table
```sql
ALTER TABLE public.cash_snapshots RENAME COLUMN run_id TO execution_id;
```

### Migration 6: `position_snapshots` — No change needed
This table has no `run_id` or session-scoped field currently.

---

## Backend Code Changes

### 1. `WorkflowRepository.ts` (line 110)
- `updatePayload.active_session_id` → `updatePayload.active_execution_id`
- Parameter name `activeSessionId` → `activeExecutionId`

### 2. `LiveTradeRepository.ts`
- `LiveTradeRow.run_id` → `LiveTradeRow.execution_id`
- Insert call: `run_id: row.run_id` → `execution_id: row.execution_id`

### 3. `LiveFillRepository.ts`
- `LiveFillRow.run_id` → `LiveFillRow.execution_id`
- `LiveFillRow.execution_id` (broker) → `LiveFillRow.broker_execution_id`

### 4. `CashSnapshotRepository.ts`
- `CashSnapshotRow.run_id` → `CashSnapshotRow.execution_id`

### 5. `FillEventBus.ts`
- `FillStreamEvent.run_id` → `FillStreamEvent.execution_id`
- `FillStreamEvent.execution_id` (broker) → `FillStreamEvent.broker_execution_id`

### 6. `SnapshotCache.ts`
- `LatestSnapshotState.run_id` → `LatestSnapshotState.execution_id`

### 7. `PortfolioExecutor.ts`
- All references passing `run_id: context.runId` for live persistence → `execution_id: context.executionId`
- `execution_id: params.executionId` (broker) → `broker_execution_id: params.executionId`

### 8. `FillSyncWorker.ts`
- Field mapping: `execution_id` (broker) → `broker_execution_id`
- `run_id` → `execution_id` for session-scoped field

### 9. `RunSyncService.ts`
- Already writes `execution_id` — verify the field name matches the renamed `workflow_runs.execution_id` column (was `session_id`)

### 10. `market-stream-service/src/types/supabase.ts`
- Update `workflow_runs` type: remove `session_id`, ensure `execution_id` present

### 11. `coreza-backend/src/types/supabase.ts`
- Update `workflow_runs` type: `session_id` → `execution_id`
- Update `workflows` references if any

---

## Frontend Code Changes

### 12. `src/hooks/useLiveStrategyDetail.ts`
- Line 108: `active_session_id` → `active_execution_id` in select query
- Line 128: `(wf as any).active_session_id` → `(wf as any).active_execution_id`
- Line 346 comment: update reference
- Line 362: `updated.active_session_id` → `updated.active_execution_id`
- Lines 168, 176, 184: `.eq("run_id", sessionRunId)` → `.eq("execution_id", sessionRunId)`
- All live_fills queries referencing `execution_id` for broker data should use `broker_execution_id`

### 13. `src/integrations/supabase/types.ts`
- Auto-regenerates from Supabase schema after migrations — no manual edit needed

### 14. `src/hooks/useWorkflowActivation.ts` (if it references `active_session_id`)
- Update localStorage key names or field references as needed

---

## What Does NOT Need `execution_id`

| Table | Reason |
|-------|--------|
| `position_snapshots` | No session scoping — stores point-in-time position data per credential |
| `backtest_*` tables | Backtests have their own `backtest_id` scoping — unrelated to live execution sessions |

---

## Verification After Implementation

1. Activate a streaming workflow — `workflows.active_execution_id` is set
2. Per-tick runs sync to `workflow_runs.execution_id`
3. Live fills persist with `execution_id` (session) and `broker_execution_id` (broker)
4. Live trades persist with `execution_id` (session)
5. Cash snapshots persist with `execution_id` (session)
6. Frontend filters all live data by `execution_id` correctly

