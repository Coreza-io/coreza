ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS node_clusters jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;

ALTER TABLE public.workflow_versions
  ADD COLUMN IF NOT EXISTS node_clusters jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.workflow_runs
  ADD COLUMN IF NOT EXISTS node_clusters jsonb NOT NULL DEFAULT '[]'::jsonb;