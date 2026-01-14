ALTER TABLE workflow_runs
ADD COLUMN IF NOT EXISTS schedule_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_schedule_key_unique
ON workflow_runs (workflow_id, schedule_key)
WHERE schedule_key IS NOT NULL;
