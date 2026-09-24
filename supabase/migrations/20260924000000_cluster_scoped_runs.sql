-- Persist immutable execution scope and make manual submission idempotent.
ALTER TABLE public.workflow_runs
  ADD COLUMN IF NOT EXISTS source_workflow_revision bigint,
  ADD COLUMN IF NOT EXISTS scope_kind text NOT NULL DEFAULT 'workflow',
  ADD COLUMN IF NOT EXISTS scope_cluster_id uuid,
  ADD COLUMN IF NOT EXISTS scope_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_manual_idempotency
  ON public.workflow_runs (workflow_id, initiated_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_workflow_run_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.scope_kind NOT IN ('workflow', 'cluster') THEN
    RAISE EXCEPTION 'invalid-workflow-run-scope-kind';
  END IF;
  IF (NEW.scope_kind = 'cluster') <> (NEW.scope_cluster_id IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid-workflow-run-cluster-scope';
  END IF;
  IF jsonb_typeof(NEW.scope_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'invalid-workflow-run-scope-snapshot';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_runs_validate_scope ON public.workflow_runs;
CREATE TRIGGER workflow_runs_validate_scope
  BEFORE INSERT OR UPDATE OF scope_kind, scope_cluster_id, scope_snapshot
  ON public.workflow_runs
  FOR EACH ROW EXECUTE FUNCTION public.validate_workflow_run_scope();

REVOKE INSERT, UPDATE, DELETE ON TABLE public.workflow_runs FROM anon, authenticated;
GRANT SELECT ON TABLE public.workflow_runs TO authenticated;
