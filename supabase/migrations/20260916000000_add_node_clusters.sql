ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS node_clusters jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.workflow_versions
  ADD COLUMN IF NOT EXISTS node_clusters jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.workflow_runs
  ADD COLUMN IF NOT EXISTS node_clusters jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workflows_node_clusters_array'
      AND conrelid = 'public.workflows'::regclass
  ) THEN
    ALTER TABLE public.workflows
      ADD CONSTRAINT workflows_node_clusters_array CHECK (jsonb_typeof(node_clusters) = 'array');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workflow_versions_node_clusters_array'
      AND conrelid = 'public.workflow_versions'::regclass
  ) THEN
    ALTER TABLE public.workflow_versions
      ADD CONSTRAINT workflow_versions_node_clusters_array CHECK (jsonb_typeof(node_clusters) = 'array');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workflow_runs_node_clusters_array'
      AND conrelid = 'public.workflow_runs'::regclass
  ) THEN
    ALTER TABLE public.workflow_runs
      ADD CONSTRAINT workflow_runs_node_clusters_array CHECK (jsonb_typeof(node_clusters) = 'array');
  END IF;
END
$$;
