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
