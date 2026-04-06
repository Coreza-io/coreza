
-- 1. workflows: rename active_session_id → active_execution_id
ALTER TABLE public.workflows RENAME COLUMN active_session_id TO active_execution_id;

-- 2. workflow_runs: rename session_id → execution_id
ALTER TABLE public.workflow_runs RENAME COLUMN session_id TO execution_id;

-- 3. live_trades: rename run_id → execution_id
ALTER TABLE public.live_trades RENAME COLUMN run_id TO execution_id;

-- 4. live_fills: rename existing execution_id (broker) → broker_execution_id, then run_id → execution_id
ALTER TABLE public.live_fills RENAME COLUMN execution_id TO broker_execution_id;
ALTER TABLE public.live_fills RENAME COLUMN run_id TO execution_id;

-- 5. cash_snapshots: rename run_id → execution_id
ALTER TABLE public.cash_snapshots RENAME COLUMN run_id TO execution_id;
