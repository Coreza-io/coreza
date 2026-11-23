ALTER TABLE public.workflow_runs
  ADD COLUMN parent_run_id uuid,
  ADD COLUMN bar_sequence integer,
  ADD COLUMN bar_index integer,
  ADD COLUMN bar_symbol text,
  ADD COLUMN bar_time timestamptz,
  ADD CONSTRAINT workflow_runs_bar_sequence_key UNIQUE (parent_run_id, bar_sequence),
  ADD CONSTRAINT workflow_runs_parent_owner_key UNIQUE (id, workflow_id, initiated_by),
  ADD CONSTRAINT workflow_runs_bar_parent_fkey
    FOREIGN KEY (parent_run_id, workflow_id, initiated_by)
    REFERENCES public.workflow_runs (id, workflow_id, initiated_by) ON DELETE CASCADE,
  ADD CONSTRAINT workflow_runs_bar_fields_check CHECK (
    CASE WHEN parent_run_id IS NULL THEN
      bar_sequence IS NULL AND bar_index IS NULL AND bar_symbol IS NULL AND bar_time IS NULL
    ELSE
      parent_run_id <> id AND initiated_by IS NOT NULL
      AND bar_sequence IS NOT NULL AND bar_sequence >= 0
      AND bar_index IS NOT NULL AND bar_index >= 0
      AND bar_symbol IS NOT NULL AND bar_time IS NOT NULL
      AND completed_at IS NOT NULL AND status IN ('success', 'failed', 'cancelled')
    END
  );

CREATE INDEX workflow_runs_history_start_idx
  ON public.workflow_runs (workflow_id, started_at DESC, id DESC);
CREATE INDEX workflow_runs_bar_time_idx
  ON public.workflow_runs (workflow_id, bar_time DESC, id DESC) WHERE bar_time IS NOT NULL;
CREATE INDEX workflow_runs_bar_symbol_time_idx
  ON public.workflow_runs (workflow_id, bar_symbol, bar_time DESC, id DESC) WHERE bar_time IS NOT NULL;

-- Publish parent run changes only. UPDATE and DELETE filters require replica identity.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER TABLE public.workflow_runs REPLICA IDENTITY FULL;
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'workflow_runs'
    ) THEN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.workflow_runs;
    END IF;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workflow_runs WHERE (parent_run_id IS NULL);
  END IF;
END $$;

-- Save the reporting ID in the existing parent metadata in the same transaction.
CREATE FUNCTION public.create_backtest_report(p_run_id uuid, p_report jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  report public.backtests%ROWTYPE := jsonb_populate_record(NULL::public.backtests, p_report);
  report_id uuid;
BEGIN
  SELECT (scope_snapshot->>'backtestId')::uuid INTO report_id FROM public.workflow_runs
    WHERE id = p_run_id AND workflow_id = report.workflow_id AND initiated_by = report.user_id
      AND parent_run_id IS NULL AND status = 'running'
      AND scope_snapshot @> '{"executionMode":"backtest"}'
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'backtest reporting parent is no longer active'; END IF;
  IF report_id IS NOT NULL THEN RETURN report_id; END IF;

  INSERT INTO public.backtests
    (workflow_id, user_id, name, description, status, initial_capital, commission_rate, slippage_rate,
     start_date, end_date, started_at)
    VALUES (report.workflow_id, report.user_id, report.name, report.description, 'running', report.initial_capital,
      report.commission_rate, report.slippage_rate, report.start_date, report.end_date, now())
    RETURNING id INTO report_id;
  UPDATE public.workflow_runs
    SET scope_snapshot = scope_snapshot || jsonb_build_object('backtestId', report_id)
    WHERE id = p_run_id;
  RETURN report_id;
END $$;
REVOKE ALL ON FUNCTION public.create_backtest_report(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_backtest_report(uuid,jsonb) TO service_role;

-- Lock the parent once per batch so recovery and finalization cannot race inserts.
CREATE FUNCTION public.write_backtest_bar_batch(p_run_id uuid, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM 1 FROM public.workflow_runs
    WHERE id = p_run_id AND parent_run_id IS NULL AND status IN ('running', 'cancelling')
      AND scope_snapshot @> '{"executionMode":"backtest"}'
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'backtest bar parent is no longer active'; END IF;

  INSERT INTO public.workflow_runs
    (id, workflow_id, initiated_by, parent_run_id, bar_sequence, bar_index, bar_symbol, bar_time,
     started_at, completed_at, status, error_message, result)
    SELECT id, workflow_id, initiated_by, p_run_id, bar_sequence, bar_index, bar_symbol, bar_time,
      started_at, completed_at, status, error_message, result
    FROM jsonb_populate_recordset(NULL::public.workflow_runs, p_rows)
    ON CONFLICT (parent_run_id, bar_sequence) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.write_backtest_bar_batch(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_backtest_bar_batch(uuid,jsonb) TO service_role;

-- Stage exceptional payloads in bounded requests and publish the complete row atomically.
CREATE TABLE public.workflow_bar_result_parts (
  parent_run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  bar_sequence integer NOT NULL,
  part_index integer NOT NULL CHECK (part_index >= 0),
  payload bytea NOT NULL,
  PRIMARY KEY (parent_run_id, bar_sequence, part_index)
);
ALTER TABLE public.workflow_bar_result_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.workflow_bar_result_parts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.workflow_bar_result_parts TO service_role;

CREATE FUNCTION public.write_backtest_bar_result_part(
  p_row jsonb, p_part_index integer, p_payload text, p_final boolean
) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  bar public.workflow_runs%ROWTYPE := jsonb_populate_record(NULL::public.workflow_runs, p_row);
  result_json jsonb;
  parent_status text;
  part_count bigint;
BEGIN
  -- Serialize retries for a parent, including requests whose HTTP response was lost.
  SELECT status INTO parent_status FROM public.workflow_runs
    WHERE id = bar.parent_run_id AND workflow_id = bar.workflow_id AND initiated_by = bar.initiated_by
      AND parent_run_id IS NULL AND scope_snapshot @> '{"executionMode":"backtest"}'
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'backtest bar parent not found'; END IF;

  IF p_payload IS NULL THEN
    DELETE FROM public.workflow_bar_result_parts
      WHERE parent_run_id = bar.parent_run_id AND bar_sequence = bar.bar_sequence;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.workflow_runs
    WHERE parent_run_id = bar.parent_run_id AND bar_sequence = bar.bar_sequence) THEN
    RETURN;
  END IF;

  IF parent_status NOT IN ('running', 'cancelling') THEN
    RAISE EXCEPTION 'backtest bar parent is no longer active';
  END IF;

  INSERT INTO public.workflow_bar_result_parts (parent_run_id, bar_sequence, part_index, payload)
    VALUES (bar.parent_run_id, bar.bar_sequence, p_part_index, decode(p_payload, 'base64'))
    ON CONFLICT DO NOTHING;

  IF NOT p_final THEN RETURN; END IF;

  SELECT convert_from(string_agg(payload, ''::bytea ORDER BY part_index), 'UTF8')::jsonb, count(*)
    INTO result_json, part_count FROM public.workflow_bar_result_parts
    WHERE parent_run_id = bar.parent_run_id AND bar_sequence = bar.bar_sequence AND part_index <= p_part_index;
  IF part_count <> p_part_index + 1 THEN RAISE EXCEPTION 'backtest bar history is missing result parts'; END IF;

  PERFORM public.write_backtest_bar_batch(bar.parent_run_id, jsonb_build_array(
    p_row || jsonb_build_object('result', result_json, 'error_message', result_json->'error'->>'message')
  ));
  DELETE FROM public.workflow_bar_result_parts
    WHERE parent_run_id = bar.parent_run_id AND bar_sequence = bar.bar_sequence;
END $$;
REVOKE ALL ON FUNCTION public.write_backtest_bar_result_part(jsonb,integer,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_backtest_bar_result_part(jsonb,integer,text,boolean) TO service_role;

CREATE FUNCTION public.start_backtest_run(p_run_id uuid, p_workflow_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM 1 FROM public.workflow_runs
    WHERE id = p_run_id AND workflow_id = p_workflow_id AND initiated_by = p_user_id
      AND parent_run_id IS NULL AND status = 'queued'
      AND scope_snapshot @> '{"executionMode":"backtest"}'
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.workflows
    SET is_active = true, active_execution_id = p_run_id, schedule_cron = NULL, updated_at = now()
    WHERE id = p_workflow_id AND user_id = p_user_id AND is_active IS FALSE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.workflow_runs SET status = 'running', started_at = now() WHERE id = p_run_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.start_backtest_run(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_backtest_run(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.finalize_backtest_run(
  p_run_id uuid, p_workflow_id uuid, p_user_id uuid, p_status text, p_error_message text, p_result jsonb,
  p_expected_started_at timestamptz DEFAULT NULL, p_expected_status text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  prior_status text;
  final_status text;
  report_id uuid;
  diagnostic text := p_error_message;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('success', 'failed') THEN RAISE EXCEPTION 'invalid backtest outcome'; END IF;

  SELECT status, (scope_snapshot->>'backtestId')::uuid INTO prior_status, report_id FROM public.workflow_runs
    WHERE id = p_run_id AND workflow_id = p_workflow_id AND initiated_by = p_user_id
      AND parent_run_id IS NULL AND scope_snapshot @> '{"executionMode":"backtest"}'
      AND (p_expected_started_at IS NULL OR started_at = p_expected_started_at)
      AND (p_expected_status IS NULL OR status = p_expected_status)
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF prior_status NOT IN ('queued', 'running', 'cancelling') THEN RETURN prior_status; END IF;

  final_status := CASE WHEN prior_status = 'cancelling' THEN 'cancelled' ELSE p_status END;
  IF final_status = 'cancelled' THEN
    diagnostic := coalesce(diagnostic, 'Run cancelled by user');
    IF p_result->'success' = 'true'::jsonb THEN
      p_result := p_result || jsonb_build_object('success', false, 'error',
        jsonb_build_object('code', 'CANCELLED', 'message', diagnostic, 'phase', 'execute'));
    END IF;
  END IF;

  UPDATE public.workflow_runs
    SET status = final_status, completed_at = now(), error_message = diagnostic,
      cancel_acknowledged_at = CASE WHEN final_status = 'cancelled' THEN now() ELSE cancel_acknowledged_at END,
      result = coalesce(p_result, result)
    WHERE id = p_run_id;

  -- Successful simulation results survive a history failure. Rows stranded by a worker exit are terminal here.
  IF final_status IN ('failed', 'cancelled') THEN
    UPDATE public.backtests
      SET status = final_status, completed_at = now(), error_message = diagnostic
      WHERE id = report_id AND workflow_id = p_workflow_id AND user_id = p_user_id
        AND status IN ('pending', 'running');
  END IF;

  UPDATE public.workflows
    SET is_active = false, active_execution_id = NULL, schedule_cron = NULL, updated_at = now()
    WHERE id = p_workflow_id AND user_id = p_user_id AND active_execution_id = p_run_id;
  DELETE FROM public.workflow_bar_result_parts WHERE parent_run_id = p_run_id;
  RETURN final_status;
END $$;
REVOKE ALL ON FUNCTION public.finalize_backtest_run(uuid,uuid,uuid,text,text,jsonb,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_backtest_run(uuid,uuid,uuid,text,text,jsonb,timestamptz,text) TO service_role;
