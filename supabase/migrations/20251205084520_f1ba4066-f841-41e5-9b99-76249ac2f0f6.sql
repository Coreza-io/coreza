-- Index for faster execution history queries
-- Optimizes: SELECT * FROM workflow_runs WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT 50

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_started 
ON workflow_runs (workflow_id, started_at DESC);

-- Additional index for status filtering
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_status 
ON workflow_runs (workflow_id, status);

-- Comment for documentation
COMMENT ON INDEX idx_workflow_runs_workflow_started IS 
'Composite index for execution history queries ordered by started_at';