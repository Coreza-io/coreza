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
      AND parent_run_id IS NULL
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

  INSERT INTO public.workflow_runs
    (id, workflow_id, initiated_by, parent_run_id, bar_sequence, bar_index, bar_symbol, bar_time,
     started_at, completed_at, status, error_message, result)
    VALUES (bar.id, bar.workflow_id, bar.initiated_by, bar.parent_run_id, bar.bar_sequence, bar.bar_index,
      bar.bar_symbol, bar.bar_time, bar.started_at, bar.completed_at, bar.status, result_json->'error'->>'message', result_json)
    ON CONFLICT (parent_run_id, bar_sequence) DO NOTHING;
  DELETE FROM public.workflow_bar_result_parts
    WHERE parent_run_id = bar.parent_run_id AND bar_sequence = bar.bar_sequence;
END $$;
REVOKE ALL ON FUNCTION public.write_backtest_bar_result_part(jsonb,integer,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_backtest_bar_result_part(jsonb,integer,text,boolean) TO service_role;

CREATE FUNCTION public.recover_backtest_run(p_run_id uuid, p_started_at timestamptz, p_status text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  stopped public.workflow_runs%ROWTYPE;
BEGIN
  UPDATE public.workflow_runs
    SET status = CASE WHEN p_status = 'cancelling' THEN 'cancelled' ELSE 'failed' END,
      completed_at = now(),
      cancel_acknowledged_at = CASE WHEN p_status = 'cancelling' THEN now() ELSE cancel_acknowledged_at END,
      error_message = 'Backtest worker stopped before completion. Bar history may be incomplete.'
    WHERE id = p_run_id AND started_at = p_started_at AND status = p_status
      AND status IN ('queued', 'running', 'cancelling') AND parent_run_id IS NULL
      AND scope_snapshot @> '{"executionMode":"backtest"}'
    RETURNING * INTO stopped;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.workflows
    SET is_active = false, active_execution_id = NULL, schedule_cron = NULL, updated_at = now()
    WHERE id = stopped.workflow_id AND user_id = stopped.initiated_by AND active_execution_id = stopped.id;
  DELETE FROM public.workflow_bar_result_parts WHERE parent_run_id = stopped.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.recover_backtest_run(uuid,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_backtest_run(uuid,timestamptz,text) TO service_role;
