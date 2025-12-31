-- Drop the existing status check constraint
ALTER TABLE workflow_runs 
DROP CONSTRAINT IF EXISTS workflow_runs_status_check;

-- Add new constraint with 'cancelled' included
ALTER TABLE workflow_runs 
ADD CONSTRAINT workflow_runs_status_check 
CHECK (status = ANY (ARRAY['pending', 'queued', 'running', 'success', 'failed', 'cancelled']));