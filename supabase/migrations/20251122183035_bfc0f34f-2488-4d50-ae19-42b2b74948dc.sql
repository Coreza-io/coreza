-- Drop the old constraint that doesn't include 'queued'
ALTER TABLE workflow_runs 
DROP CONSTRAINT workflow_runs_status_check;

-- Add the new constraint with 'queued' included
ALTER TABLE workflow_runs 
ADD CONSTRAINT workflow_runs_status_check 
CHECK (status = ANY (ARRAY['pending'::text, 'queued'::text, 'running'::text, 'success'::text, 'failed'::text]));