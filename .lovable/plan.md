

# Analysis: Where Should `active_session_id` Live?

## Current ID Hierarchy

```text
active_session_id (= runnerInstanceId)     ← SESSION level, one per activation
  ├── executionRunId_1 (tick 1)            ← PER-TICK, stored in workflow_runs.id
  ├── executionRunId_2 (tick 2)
  ├── executionRunId_3 (tick 3)
  └── ...
```

## How Each Table Currently Uses IDs

| Table | `run_id` column holds | Can find session? |
|-------|----------------------|-------------------|
| `live_trades` | `runnerInstanceId` (= `active_session_id`) | Yes, `run_id = active_session_id` |
| `live_fills` | `runnerInstanceId` (= `active_session_id`) | Yes, `run_id = active_session_id` |
| `cash_snapshots` | `runnerInstanceId` (= `active_session_id`) | Yes, `run_id = active_session_id` |
| `workflow_runs` | `executionRunId` (per-tick ID) | **NO** — no link back to session |
| `workflows` | `active_session_id` column | Yes — source of truth |

## The Gap

`workflow_runs` stores one record per tick with `id = executionRunId`. There is **no column** linking these back to the session (`active_session_id`). So you **cannot** query "give me all runs for this activation session."

## What Needs to Change

### Option A: Add `session_id` column to `workflow_runs` (Recommended)

Add a nullable `session_id UUID` column to `workflow_runs`. When `WorkflowRunner.processMessage()` calls `createRunInRedis()`, pass `this.runnerInstanceId` as `session_id`.

This gives the complete picture:
```text
workflows.active_session_id = "abc-123"
  └── workflow_runs WHERE session_id = "abc-123"
        ├── run_id_1 (tick 1)
        ├── run_id_2 (tick 2)
        └── ...
  └── live_trades WHERE run_id = "abc-123"
  └── live_fills WHERE run_id = "abc-123"
  └── cash_snapshots WHERE run_id = "abc-123"
```

### Do live_trades/live_fills/cash_snapshots Need a Separate `session_id` Column?

**No.** In these tables, `run_id` already IS the `active_session_id` (the `runnerInstanceId`). Adding a separate `session_id` column would be redundant — same value, different name. The current `run_id` filter works perfectly.

### Do We Need `active_session_id` in `workflow_runs`?

**Yes.** Because `workflow_runs.id` = `executionRunId` (per-tick), which is a *different* ID than the session. Without a `session_id` column, you can't group runs by activation session.

## Summary of ID Usage

```text
┌─────────────────────────────────────────────────────┐
│ workflows.active_session_id = runnerInstanceId      │
│   (session-level, one per activation)               │
├─────────────────────────────────────────────────────┤
│ live_trades.run_id      = runnerInstanceId  ✅      │
│ live_fills.run_id       = runnerInstanceId  ✅      │
│ cash_snapshots.run_id   = runnerInstanceId  ✅      │
│ workflow_runs.session_id = runnerInstanceId  ❌ NEW │
│ workflow_runs.id         = executionRunId (per-tick) │
└─────────────────────────────────────────────────────┘
```

## Changes Required

| Layer | File | Change |
|-------|------|--------|
| DB | Migration | Add `session_id UUID` to `workflow_runs` |
| Backend | `redisRunStorage.ts` | Accept + store `sessionId` in run data |
| Backend | `WorkflowRunner.ts` | Pass `this.runnerInstanceId` to `createRunInRedis()` as `sessionId` |
| Backend | `RunSyncService.ts` | Map `session_id` when syncing from Redis to Supabase |
| Frontend | `useLiveStrategyDetail.ts` | No change needed — already filters by `active_session_id` via `run_id` on trades/fills/snapshots |

No changes needed to `live_trades`, `live_fills`, or `cash_snapshots` — their `run_id` already equals `active_session_id`.

