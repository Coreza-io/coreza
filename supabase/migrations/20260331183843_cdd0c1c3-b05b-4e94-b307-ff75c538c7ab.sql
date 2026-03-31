-- Add idempotency and workflow tracking columns to live_fills
ALTER TABLE live_fills ADD COLUMN IF NOT EXISTS event_id text;
ALTER TABLE live_fills ADD COLUMN IF NOT EXISTS execution_id text;
ALTER TABLE live_fills ADD COLUMN IF NOT EXISTS workflow_id uuid;
ALTER TABLE live_fills ADD COLUMN IF NOT EXISTS run_id uuid;

-- Create unique constraint for dedup
ALTER TABLE live_fills
  ADD CONSTRAINT uq_live_fills_event_id UNIQUE (user_id, broker, event_id);

-- Index for dashboard queries filtered by workflow
CREATE INDEX IF NOT EXISTS idx_live_fills_workflow
  ON live_fills (user_id, workflow_id);

-- Expand cash_snapshots with structured fields
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS workflow_id uuid;
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS run_id uuid;
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS base_currency text;
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS cash numeric;
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS equity numeric;
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS realized_pnl numeric;
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS unrealized_pnl numeric;
ALTER TABLE cash_snapshots ADD COLUMN IF NOT EXISTS positions_count integer;