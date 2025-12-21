-- Add nodes/edges snapshot columns to workflow_runs
ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS nodes JSONB,
  ADD COLUMN IF NOT EXISTS edges JSONB,
  ADD COLUMN IF NOT EXISTS node_count INTEGER,
  ADD COLUMN IF NOT EXISTS edge_count INTEGER;

-- Add index for workflow_id lookup performance
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);

-- Add UPDATE policy so backend can update runs with snapshot data
CREATE POLICY "Users can update their own workflow runs"
  ON workflow_runs FOR UPDATE
  USING (auth.uid() IN (
    SELECT user_id FROM workflows WHERE id = workflow_runs.workflow_id
  ));