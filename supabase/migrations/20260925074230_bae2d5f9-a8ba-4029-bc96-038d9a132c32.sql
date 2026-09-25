ALTER TABLE public.workflow_runs
  ADD COLUMN IF NOT EXISTS source_workflow_revision bigint,
  ADD COLUMN IF NOT EXISTS scope_kind text NOT NULL DEFAULT 'workflow',
  ADD COLUMN IF NOT EXISTS scope_cluster_id uuid,
  ADD COLUMN IF NOT EXISTS scope_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_acknowledged_at timestamptz;

ALTER TABLE public.workflow_runs
  DROP CONSTRAINT IF EXISTS workflow_runs_status_check;

CREATE OR REPLACE FUNCTION public.validate_workflow_run_contract()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'queued', 'running', 'cancelling', 'success', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid-workflow-run-status';
  END IF;
  IF NEW.scope_kind NOT IN ('workflow', 'cluster') THEN
    RAISE EXCEPTION 'invalid-workflow-run-scope-kind';
  END IF;
  IF (NEW.scope_kind = 'cluster') <> (NEW.scope_cluster_id IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid-workflow-run-cluster-scope';
  END IF;
  IF jsonb_typeof(NEW.scope_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'invalid-workflow-run-scope-snapshot';
  END IF;
  IF NEW.scope_kind = 'cluster' AND (
    NEW.source_workflow_revision IS NULL OR
    NEW.idempotency_key IS NULL OR
    NEW.request_fingerprint IS NULL OR
    length(NEW.request_fingerprint) = 0
  ) THEN
    RAISE EXCEPTION 'incomplete-cluster-run-contract';
  END IF;
  IF NEW.cancel_acknowledged_at IS NOT NULL AND NEW.cancel_requested_at IS NULL THEN
    RAISE EXCEPTION 'invalid-workflow-run-cancellation-state';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_runs_validate_scope ON public.workflow_runs;
DROP TRIGGER IF EXISTS workflow_runs_validate_contract ON public.workflow_runs;
CREATE TRIGGER workflow_runs_validate_contract
  BEFORE INSERT OR UPDATE OF status, scope_kind, scope_cluster_id, scope_snapshot,
    source_workflow_revision, idempotency_key, request_fingerprint,
    cancel_requested_at, cancel_acknowledged_at
  ON public.workflow_runs
  FOR EACH ROW EXECUTE FUNCTION public.validate_workflow_run_contract();

CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_manual_idempotency
  ON public.workflow_runs (workflow_id, initiated_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS workflow_runs_active_cluster_lookup
  ON public.workflow_runs (workflow_id, initiated_by, scope_cluster_id, started_at DESC)
  WHERE scope_kind = 'cluster' AND status IN ('pending', 'queued', 'running', 'cancelling');

CREATE INDEX IF NOT EXISTS workflow_runs_cancellation_pending
  ON public.workflow_runs (cancel_requested_at)
  WHERE cancel_requested_at IS NOT NULL AND cancel_acknowledged_at IS NULL;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.workflow_runs FROM anon, authenticated;
GRANT SELECT ON TABLE public.workflow_runs TO authenticated;
GRANT ALL ON TABLE public.workflow_runs TO service_role;