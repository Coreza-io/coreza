-- Coreza Trading Platform Database Schema (fresh installs only)

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =======================================
-- Tables
-- =======================================

CREATE TABLE IF NOT EXISTS public.users (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid UNIQUE,
  first_name varchar NOT NULL,
  last_name varchar NOT NULL,
  phone text,
  location text,
  timezone text,
  selected_markets text[],
  CONSTRAINT users_selected_markets_allowed CHECK (
    selected_markets IS NULL OR (
      selected_markets <@ ARRAY['nyse', 'nasdaq', 'nse', 'bse', 'crypto']::text[]
      AND array_position(selected_markets, NULL) IS NULL
      AND (cardinality(selected_markets) = 0 OR array_ndims(selected_markets) = 1)
    )
  ),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.projects (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workflows (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  project_id uuid,
  name text NOT NULL,
  nodes jsonb NOT NULL,
  edges jsonb NOT NULL,
  node_clusters jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(node_clusters) = 'array'),
  revision bigint NOT NULL DEFAULT 0,
  schedule_cron text,
  is_active boolean,
  persistent_state jsonb DEFAULT '{}'::jsonb,
  active_execution_id uuid DEFAULT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT workflows_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL,
  CONSTRAINT workflows_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.workflow_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  name text NOT NULL,
  nodes jsonb NOT NULL,
  edges jsonb NOT NULL,
  node_clusters jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(node_clusters) = 'array'),
  node_count integer NOT NULL,
  edge_count integer NOT NULL,
  change_description text,
  is_active boolean DEFAULT false,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT workflow_versions_workflow_version_unique UNIQUE (workflow_id, version_number)
);

CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  initiated_by uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  result jsonb,
  error_message text,
  nodes jsonb,
  edges jsonb,
  node_clusters jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(node_clusters) = 'array'),
  node_count integer,
  edge_count integer,
  schedule_key text,
  execution_id uuid DEFAULT NULL,
  source_workflow_revision bigint,
  scope_kind text NOT NULL DEFAULT 'workflow',
  scope_cluster_id uuid,
  scope_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key uuid,
  request_fingerprint text,
  cancel_requested_at timestamptz,
  cancel_acknowledged_at timestamptz,
  CONSTRAINT workflow_runs_scope_kind_check CHECK (scope_kind IN ('workflow', 'cluster'))
);

CREATE TABLE IF NOT EXISTS public.user_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  service_type text NOT NULL,
  name text NOT NULL,
  enc_payload text,
  iv text,
  auth_tag text,
  dek_wrapped text,
  is_encrypted boolean DEFAULT false,
  enc_version smallint DEFAULT 1,
  key_algo text DEFAULT 'AES-256-GCM',
  key_ref text DEFAULT 'env:v1',
  scopes text,
  client_json jsonb DEFAULT '{}'::jsonb,
  token_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT user_credentials_user_service_name_key UNIQUE (user_id, service_type, name)
);

CREATE TABLE IF NOT EXISTS public.backtests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending',
  start_date date NOT NULL,
  end_date date NOT NULL,
  initial_capital numeric NOT NULL DEFAULT 100000,
  commission_rate numeric,
  slippage_rate numeric,
  data_frequency text NOT NULL DEFAULT '1D',
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.live_fills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fill_id text NOT NULL,
  broker text NOT NULL,
  credential_id uuid NOT NULL,
  user_id uuid NOT NULL,
  workflow_id uuid,
  execution_id uuid,
  symbol text NOT NULL,
  side text NOT NULL,
  qty numeric NOT NULL,
  price numeric NOT NULL,
  commission numeric NOT NULL DEFAULT 0,
  commission_asset text,
  quote_qty numeric,
  order_id text,
  order_type text,
  "timeInForce" text,
  limit_price numeric,
  stop_price numeric,
  trail_price numeric,
  trail_percent numeric,
  tag text,
  fill_status text,
  reject_reason text,
  algo_id text,
  event_time timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_live_fills_dedup UNIQUE (user_id, broker, symbol, fill_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_schedule_key_unique
ON public.workflow_runs (workflow_id, schedule_key) WHERE schedule_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON public.workflow_runs(workflow_id);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_manual_idempotency ON public.workflow_runs(workflow_id, initiated_by, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS workflow_runs_active_cluster_lookup ON public.workflow_runs(workflow_id, initiated_by, scope_cluster_id, started_at DESC) WHERE scope_kind = 'cluster' AND status IN ('pending', 'queued', 'running', 'cancelling');
CREATE INDEX IF NOT EXISTS workflow_runs_cancellation_pending ON public.workflow_runs(cancel_requested_at) WHERE cancel_requested_at IS NOT NULL AND cancel_acknowledged_at IS NULL;

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
  IF NEW.scope_kind = 'cluster' AND (NEW.source_workflow_revision IS NULL OR NEW.idempotency_key IS NULL OR NEW.request_fingerprint IS NULL OR length(NEW.request_fingerprint) = 0) THEN
    RAISE EXCEPTION 'incomplete-cluster-run-contract';
  END IF;
  IF NEW.cancel_acknowledged_at IS NOT NULL AND NEW.cancel_requested_at IS NULL THEN
    RAISE EXCEPTION 'invalid-workflow-run-cancellation-state';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_runs_validate_contract ON public.workflow_runs;
CREATE TRIGGER workflow_runs_validate_contract
  BEFORE INSERT OR UPDATE OF status, scope_kind, scope_cluster_id, scope_snapshot, source_workflow_revision, idempotency_key, request_fingerprint, cancel_requested_at, cancel_acknowledged_at
  ON public.workflow_runs FOR EACH ROW EXECUTE FUNCTION public.validate_workflow_run_contract();
CREATE INDEX IF NOT EXISTS idx_live_fills_user_symbol ON public.live_fills(user_id, broker, symbol, fill_id);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_fills ENABLE ROW LEVEL SECURITY;

-- representative idempotent policies for all OSS tables
DROP POLICY IF EXISTS "Users can view their own profile" ON public.users;
CREATE POLICY "Users can view their own profile" ON public.users FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.users;
CREATE POLICY "Users can insert their own profile" ON public.users FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
CREATE POLICY "Users can update their own profile" ON public.users FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own rows" ON public.backtests;
CREATE POLICY "Users can view own rows" ON public.backtests FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own rows" ON public.backtests;
CREATE POLICY "Users can insert own rows" ON public.backtests FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own rows" ON public.backtests;
CREATE POLICY "Users can update own rows" ON public.backtests FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own rows" ON public.backtests;
CREATE POLICY "Users can delete own rows" ON public.backtests FOR DELETE USING (auth.uid() = user_id);

-- Reuse existing policies style
DROP POLICY IF EXISTS "Users can view their own projects" ON public.projects;
CREATE POLICY "Users can view their own projects" ON public.projects FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create their own projects" ON public.projects;
CREATE POLICY "Users can create their own projects" ON public.projects FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own projects" ON public.projects;
CREATE POLICY "Users can update their own projects" ON public.projects FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own projects" ON public.projects;
CREATE POLICY "Users can delete their own projects" ON public.projects FOR DELETE USING (auth.uid() = user_id);

-- Workflow versions
DROP POLICY IF EXISTS "Users can view versions of their own workflows" ON public.workflow_versions;
CREATE POLICY "Users can view versions of their own workflows" ON public.workflow_versions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.workflows WHERE workflows.id = workflow_versions.workflow_id AND workflows.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can insert versions for their own workflows" ON public.workflow_versions;
CREATE POLICY "Users can insert versions for their own workflows" ON public.workflow_versions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.workflows WHERE workflows.id = workflow_versions.workflow_id AND workflows.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Users can delete versions of their own workflows" ON public.workflow_versions;
CREATE POLICY "Users can delete versions of their own workflows" ON public.workflow_versions
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.workflows WHERE workflows.id = workflow_versions.workflow_id AND workflows.user_id = auth.uid())
  );

-- Workflow runs
DROP POLICY IF EXISTS "Users can view runs of their own workflows" ON public.workflow_runs;
CREATE POLICY "Users can view runs of their own workflows" ON public.workflow_runs
  FOR SELECT USING (
    auth.uid() IN (SELECT w.user_id FROM public.workflows w WHERE w.id = workflow_runs.workflow_id)
  );
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workflow_runs FROM anon, authenticated;
REVOKE ALL ON TABLE public.workflow_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.workflow_runs TO authenticated;
GRANT ALL ON TABLE public.workflow_runs TO service_role;
DROP POLICY IF EXISTS "Users can create runs for their own workflows" ON public.workflow_runs;
CREATE POLICY "Users can create runs for their own workflows" ON public.workflow_runs
  FOR INSERT WITH CHECK (
    auth.uid() IN (SELECT w.user_id FROM public.workflows w WHERE w.id = workflow_runs.workflow_id)
  );
DROP POLICY IF EXISTS "Users can update runs of their own workflows" ON public.workflow_runs;
CREATE POLICY "Users can update runs of their own workflows" ON public.workflow_runs
  FOR UPDATE USING (
    auth.uid() IN (SELECT w.user_id FROM public.workflows w WHERE w.id = workflow_runs.workflow_id)
  );

-- User credentials
DROP POLICY IF EXISTS "Users can view their own credentials" ON public.user_credentials;
CREATE POLICY "Users can view their own credentials" ON public.user_credentials FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create their own credentials" ON public.user_credentials;
CREATE POLICY "Users can create their own credentials" ON public.user_credentials FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own credentials" ON public.user_credentials;
CREATE POLICY "Users can update their own credentials" ON public.user_credentials FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own credentials" ON public.user_credentials;
CREATE POLICY "Users can delete their own credentials" ON public.user_credentials FOR DELETE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Service role full access" ON public.user_credentials;
CREATE POLICY "Service role full access" ON public.user_credentials FOR ALL USING (auth.role() = 'service_role') WITH CHECK (true);

-- Live-trading state tables
DROP POLICY IF EXISTS "Users can manage own live fills" ON public.live_fills;
CREATE POLICY "Users can manage own live fills" ON public.live_fills FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- (existing workflow/workflow_runs/user_credentials policies retained)
DROP POLICY IF EXISTS "Users can view their own workflows" ON public.workflows;
CREATE POLICY "Users can view their own workflows" ON public.workflows FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can create their own workflows" ON public.workflows;
CREATE POLICY "Users can create their own workflows" ON public.workflows FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own workflows" ON public.workflows;
CREATE POLICY "Users can update their own workflows" ON public.workflows FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own workflows" ON public.workflows;
CREATE POLICY "Users can delete their own workflows" ON public.workflows FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.user_credentials_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (user_id, first_name, last_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'first_name', ''), COALESCE(NEW.raw_user_meta_data->>'last_name', ''));
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_projects_updated_at') THEN
    CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_workflows_updated_at') THEN
    CREATE TRIGGER update_workflows_updated_at BEFORE UPDATE ON public.workflows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_credentials_updated_at') THEN
    CREATE TRIGGER update_user_credentials_updated_at BEFORE UPDATE ON public.user_credentials FOR EACH ROW EXECUTE FUNCTION public.user_credentials_set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END$$;

-- Enable Supabase Realtime on workflows so the editor reacts to
-- backend-driven is_active flips (e.g. auto-deactivate after backtest)
ALTER TABLE public.workflows REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'workflows'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workflows;
  END IF;
END$$;


-- =====================================================
-- AI AGENT CHAT MEMORY
-- =====================================================
CREATE TABLE IF NOT EXISTS public.coreza_chat_history (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  message JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coreza_chat_history_session
  ON public.coreza_chat_history (session_id, id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coreza_chat_history TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.coreza_chat_history_id_seq TO authenticated;
GRANT ALL ON public.coreza_chat_history TO service_role;
GRANT ALL ON SEQUENCE public.coreza_chat_history_id_seq TO service_role;

ALTER TABLE public.coreza_chat_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages chat history"
  ON public.coreza_chat_history FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Explicit Data API privileges; RLS policies above scope authenticated access.
REVOKE ALL ON public.users, public.projects, public.workflows,
  public.workflow_versions, public.workflow_runs,
  public.user_credentials, public.backtests, public.live_fills FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.users, public.projects, public.workflows,
  public.workflow_versions, public.workflow_runs,
  public.user_credentials, public.backtests, public.live_fills TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.users, public.projects, public.backtests,
  public.workflow_versions TO authenticated;
GRANT DELETE ON public.workflows TO authenticated;
GRANT ALL ON public.users, public.projects, public.workflows,
  public.workflow_versions, public.workflow_runs,
  public.user_credentials, public.backtests, public.live_fills TO service_role;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- Canonical workflow writer and hierarchy readiness (current runtime contract).
-- Workflow documents are written only by the service-role backend. Ownership RLS
-- remains in place for reads and deletes, but is not a semantic validation layer.
REVOKE INSERT, UPDATE ON TABLE public.workflows FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_workflow_document(
  p_workflow_id uuid,
  p_user_id uuid,
  p_expected_revision bigint,
  p_name text DEFAULT NULL,
  p_nodes jsonb DEFAULT NULL,
  p_edges jsonb DEFAULT NULL,
  p_node_clusters jsonb DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_cluster_format_version integer DEFAULT NULL
) RETURNS public.workflows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_row public.workflows%ROWTYPE;
  next_name text;
  next_nodes jsonb;
  next_edges jsonb;
  next_clusters jsonb;
  next_project_id uuid;
  next_version integer;
BEGIN
  SELECT * INTO current_row FROM public.workflows
    WHERE id = p_workflow_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow-not-found'; END IF;
  IF current_row.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'workflow-revision-conflict' USING ERRCODE = '40001';
  END IF;

  IF (EXISTS (SELECT 1 FROM jsonb_array_elements(current_row.node_clusters) c WHERE c ? 'parentClusterId')
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_node_clusters, '[]'::jsonb)) c WHERE c ? 'parentClusterId'))
      AND p_cluster_format_version IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'cluster-writer-upgrade-required';
  END IF;
  PERFORM set_config('coreza.cluster_format_version', COALESCE(p_cluster_format_version::text, ''), true);

  next_name := COALESCE(p_name, current_row.name);
  next_nodes := COALESCE(p_nodes, current_row.nodes);
  next_edges := COALESCE(p_edges, current_row.edges);
  next_clusters := COALESCE(p_node_clusters, current_row.node_clusters);
  next_project_id := p_project_id;

  IF jsonb_array_length(current_row.nodes) > 0 AND jsonb_array_length(next_nodes) = 0 THEN
    RAISE EXCEPTION 'empty-workflow';
  END IF;

  IF next_name = current_row.name AND next_nodes = current_row.nodes
     AND next_edges = current_row.edges AND next_clusters = current_row.node_clusters
     AND next_project_id IS NOT DISTINCT FROM current_row.project_id THEN
    RETURN current_row;
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_version
    FROM public.workflow_versions WHERE workflow_id = p_workflow_id;
  INSERT INTO public.workflow_versions
    (workflow_id, version_number, name, nodes, edges, node_clusters, is_active,
     node_count, edge_count, created_by)
  VALUES
    (current_row.id, next_version, current_row.name, current_row.nodes,
     current_row.edges, current_row.node_clusters, current_row.is_active,
     jsonb_array_length(current_row.nodes), jsonb_array_length(current_row.edges), p_user_id);

  UPDATE public.workflows SET
    name = next_name, nodes = next_nodes, edges = next_edges,
    node_clusters = next_clusters, project_id = next_project_id,
    revision = revision + 1, updated_at = now()
  WHERE id = current_row.id
  RETURNING * INTO current_row;
  RETURN current_row;
END;
$$;

REVOKE ALL ON FUNCTION public.save_workflow_document(uuid, uuid, bigint, text, jsonb, jsonb, jsonb, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_workflow_document(uuid, uuid, bigint, text, jsonb, jsonb, jsonb, uuid, integer)
  TO service_role;

-- Refuse alternate service-role graph replacements of nested documents.
CREATE OR REPLACE FUNCTION public.guard_nested_workflow_writer() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF (NEW.nodes IS DISTINCT FROM OLD.nodes OR NEW.edges IS DISTINCT FROM OLD.edges OR NEW.node_clusters IS DISTINCT FROM OLD.node_clusters)
     AND (EXISTS (SELECT 1 FROM jsonb_array_elements(OLD.node_clusters) c WHERE c ? 'parentClusterId')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.node_clusters) c WHERE c ? 'parentClusterId'))
     AND current_setting('coreza.cluster_format_version', true) IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'cluster-writer-upgrade-required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_nested_workflow_writer BEFORE UPDATE ON public.workflows
FOR EACH ROW EXECUTE FUNCTION public.guard_nested_workflow_writer();

-- Capability is observed from deployed schema/permissions, never a frontend flag.
CREATE OR REPLACE FUNCTION public.cluster_hierarchy_write_ready() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT to_regprocedure('public.save_workflow_document(uuid,uuid,bigint,text,jsonb,jsonb,jsonb,uuid,integer)') IS NOT NULL
    AND NOT has_table_privilege('authenticated', 'public.workflows', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.workflows', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.workflows', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.workflows', 'INSERT')
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_nested_workflow_writer'
      AND tgrelid = 'public.workflows'::regclass AND tgenabled = 'O');
$$;
REVOKE ALL ON FUNCTION public.cluster_hierarchy_write_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cluster_hierarchy_write_ready() TO service_role;

-- Shared reporting schema
-- Shared reporting for new backtests and live activations.
-- Deploy the schema and matching writers/readers together before resuming starts.
CREATE TABLE public.live_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL,
  user_id uuid NOT NULL,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  backtest_id uuid UNIQUE REFERENCES public.backtests(id) ON DELETE CASCADE,
  execution_id uuid UNIQUE,
  name text NOT NULL,
  source_workflow_revision bigint,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  error_message text,
  initial_capital numeric,
  base_currency text,
  metrics_updated_at timestamptz,
  metrics_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_return numeric,
  annualized_return numeric,
  sharpe_ratio numeric,
  sortino_ratio numeric,
  calmar_ratio numeric,
  max_drawdown numeric,
  win_rate numeric,
  profit_factor numeric,
  expectancy numeric,
  total_trades integer,
  profitable_trades integer,
  losing_trades integer,
  avg_win numeric,
  avg_loss numeric,
  largest_win numeric,
  largest_loss numeric,
  average_trade_return numeric,
  avg_holding_period numeric,
  net_profit numeric,
  final_portfolio_value numeric,
  total_commission numeric,
  total_slippage numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reporting_mode_identity CHECK (
    (mode='backtest' AND backtest_id IS NOT NULL AND execution_id IS NULL) OR
    (mode='live' AND backtest_id IS NULL AND execution_id IS NOT NULL AND id=execution_id))
);
CREATE TABLE public.trades (
  id uuid PRIMARY KEY,
  live_strategy_id uuid NOT NULL REFERENCES public.live_strategies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  execution_id uuid,
  symbol text NOT NULL,
  action text NOT NULL,
  quantity numeric NOT NULL,
  "entryPrice" numeric,
  "exitPrice" numeric NOT NULL,
  "entryTime" timestamptz,
  "exitTime" timestamptz NOT NULL,
  commission numeric,
  slippage numeric,
  return_pct numeric,
  net_pnl numeric,
  gross_pnl numeric,
  portfolio_value_before numeric,
  portfolio_value_after numeric,
  holding_period_bars integer,
  exit_reason text,
  entry_order_id text,
  exit_order_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.portfolio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_strategy_id uuid NOT NULL REFERENCES public.live_strategies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  execution_id uuid,
  date date,
  total_value numeric,
  equity_open numeric,
  equity_high numeric,
  equity_low numeric,
  equity_close numeric,
  equity_sample_count integer,
  cash_balance numeric,
  stock_value numeric,
  daily_return numeric,
  snapshot_at timestamptz,
  broker text,
  credential_id uuid,
  base_currency text,
  balances jsonb,
  cash numeric,
  equity numeric,
  realized_pnl numeric,
  unrealized_pnl numeric,
  positions_count integer,
  total_value_usdt numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(live_strategy_id,date),
  CONSTRAINT portfolio_equity_ohlc_valid CHECK (
    num_nonnulls(equity_open,equity_high,equity_low,equity_close,equity_sample_count)=0
    OR (
      num_nonnulls(equity_open,equity_high,equity_low,equity_close,equity_sample_count)=5
      AND equity_sample_count > 0
      AND total_value IS NOT NULL AND equity_close=total_value
      AND equity_high >= greatest(equity_open,equity_close)
      AND equity_low <= least(equity_open,equity_close)
      AND equity_high >= equity_low
      AND equity_low > '-Infinity'::numeric AND equity_high < 'Infinity'::numeric
    )
  )
);
CREATE INDEX live_strategies_owner_mode_start ON public.live_strategies(user_id,mode,started_at DESC,id DESC);
CREATE INDEX live_strategies_owner_mode_status ON public.live_strategies(user_id,mode,status);
CREATE INDEX trades_strategy_exit ON public.trades(live_strategy_id,"exitTime",id);
CREATE INDEX portfolio_strategy_snapshot ON public.portfolio(live_strategy_id,snapshot_at,id);
CREATE INDEX portfolio_snapshot_source ON public.portfolio(live_strategy_id,broker,credential_id,base_currency,snapshot_at,id);

-- Validate identity even for service-role writes. Historical names/revisions stay captured.
CREATE OR REPLACE FUNCTION public.validate_reporting_scope() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE parent public.live_strategies;
BEGIN
  IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Reporting ID is immutable'; END IF;
  IF TG_TABLE_NAME='live_strategies' THEN
    IF NOT EXISTS(SELECT 1 FROM public.workflows w WHERE w.id=NEW.workflow_id AND w.user_id=NEW.user_id) THEN
      RAISE EXCEPTION 'Reporting workflow ownership mismatch'; END IF;
    IF NEW.mode='backtest' AND NOT EXISTS(SELECT 1 FROM public.backtests b WHERE b.id=NEW.backtest_id AND b.workflow_id=NEW.workflow_id AND b.user_id=NEW.user_id) THEN
      RAISE EXCEPTION 'Reporting backtest identity mismatch'; END IF;
    IF NEW.mode='live' AND NEW.status IN ('completed','failed','cancelled') AND
      (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
      NEW.metrics_context:=NEW.metrics_context || '{"finalization_pending":true}'::jsonb;
    END IF;
    IF TG_OP='UPDATE' AND (NEW.mode,NEW.user_id,NEW.workflow_id,NEW.backtest_id,NEW.execution_id) IS DISTINCT FROM (OLD.mode,OLD.user_id,OLD.workflow_id,OLD.backtest_id,OLD.execution_id) THEN
      RAISE EXCEPTION 'Reporting identity is immutable'; END IF;
  ELSE
    IF TG_OP='UPDATE' AND NEW.live_strategy_id IS DISTINCT FROM OLD.live_strategy_id THEN
      RAISE EXCEPTION 'Reporting child parent is immutable'; END IF;
    SELECT * INTO STRICT parent FROM public.live_strategies WHERE id=NEW.live_strategy_id;
    IF (NEW.user_id IS NOT NULL AND NEW.user_id<>parent.user_id) OR
       (NEW.workflow_id IS NOT NULL AND NEW.workflow_id<>parent.workflow_id) OR
       (NEW.execution_id IS NOT NULL AND NEW.execution_id IS DISTINCT FROM parent.execution_id) THEN
      RAISE EXCEPTION 'Reporting child identity mismatch'; END IF;
    NEW.user_id:=parent.user_id; NEW.workflow_id:=parent.workflow_id;
    IF TG_TABLE_NAME='portfolio' THEN
      IF (parent.mode='live' AND NEW.snapshot_at IS NULL) OR (parent.mode='backtest' AND NEW.date IS NULL) THEN
        RAISE EXCEPTION 'Reporting snapshot source timestamp missing'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reporting_header_scope BEFORE INSERT OR UPDATE ON public.live_strategies FOR EACH ROW EXECUTE FUNCTION public.validate_reporting_scope();
CREATE TRIGGER reporting_trade_scope BEFORE INSERT OR UPDATE ON public.trades FOR EACH ROW EXECUTE FUNCTION public.validate_reporting_scope();
CREATE TRIGGER reporting_portfolio_scope BEFORE INSERT OR UPDATE ON public.portfolio FOR EACH ROW EXECUTE FUNCTION public.validate_reporting_scope();

-- Backtests remains the lifecycle authority, including all cancellation/failure paths.
CREATE OR REPLACE FUNCTION public.mirror_backtest_reporting() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid()<>NEW.user_id THEN RAISE EXCEPTION 'Backtest ownership mismatch'; END IF;
  INSERT INTO public.live_strategies(backtest_id,mode,user_id,workflow_id,name,status,started_at,completed_at,error_message,initial_capital,source_workflow_revision,metrics_context)
  VALUES(NEW.id,'backtest',NEW.user_id,NEW.workflow_id,NEW.name,NEW.status,NEW.started_at,NEW.completed_at,NEW.error_message,NEW.initial_capital,(SELECT revision FROM public.workflows WHERE id=NEW.workflow_id),
    '{"source":"backtest","granularity":"daily","average_trade_return_unit":"currency","avg_holding_period_unit":"bars"}')
  ON CONFLICT(backtest_id) DO UPDATE SET status=EXCLUDED.status,started_at=EXCLUDED.started_at,
    completed_at=EXCLUDED.completed_at,error_message=EXCLUDED.error_message,updated_at=now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mirror_backtest_reporting() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER backtest_reporting_lifecycle AFTER INSERT OR UPDATE OF status,started_at,completed_at,error_message ON public.backtests FOR EACH ROW EXECUTE FUNCTION public.mirror_backtest_reporting();

-- Atomically accept one activation before allocating resources. Only the backend may call.
CREATE OR REPLACE FUNCTION public.claim_reporting_activation(p_user_id uuid,p_workflow_id uuid,p_execution_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE w public.workflows;
BEGIN
  SELECT * INTO STRICT w FROM public.workflows WHERE id=p_workflow_id AND user_id=p_user_id FOR UPDATE;
  IF w.is_active THEN RAISE EXCEPTION 'Workflow is already active'; END IF;
  INSERT INTO public.live_strategies(id,mode,user_id,workflow_id,execution_id,name,status,started_at,source_workflow_revision,metrics_context)
  VALUES(p_execution_id,'live',p_user_id,p_workflow_id,p_execution_id,w.name,'pending',now(),w.revision,
    '{"source":"live","granularity":"intraday","initial_capital":"unavailable","average_trade_return_unit":"percent","avg_holding_period_unit":"milliseconds"}');
  UPDATE public.workflows SET is_active=true,active_execution_id=p_execution_id,updated_at=now() WHERE id=w.id;
END $$;
REVOKE ALL ON FUNCTION public.claim_reporting_activation(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reporting_activation(uuid,uuid,uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.complete_reporting_activation(p_user_id uuid,p_workflow_id uuid,p_execution_id uuid,p_schedule_cron text)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE w public.workflows;
BEGIN
  SELECT * INTO STRICT w FROM public.workflows WHERE id=p_workflow_id AND user_id=p_user_id FOR UPDATE;
  IF NOT w.is_active OR w.active_execution_id IS DISTINCT FROM p_execution_id THEN
    RAISE EXCEPTION 'Activation ownership changed during startup'; END IF;
  UPDATE public.live_strategies SET status='running',updated_at=now()
    WHERE id=p_execution_id AND mode='live' AND user_id=p_user_id AND workflow_id=p_workflow_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Activation is no longer pending'; END IF;
  UPDATE public.workflows SET schedule_cron=p_schedule_cron,updated_at=now() WHERE id=w.id RETURNING * INTO w;
  RETURN to_jsonb(w);
END $$;
REVOKE ALL ON FUNCTION public.complete_reporting_activation(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_reporting_activation(uuid,uuid,uuid,text) TO service_role;

-- Reporting is written by the backend and read through parent ownership.
ALTER TABLE public.live_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_strategies,public.trades,public.portfolio FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.live_strategies,public.trades,public.portfolio TO authenticated;
GRANT ALL ON public.live_strategies,public.trades,public.portfolio TO service_role;
CREATE POLICY reporting_owner ON public.live_strategies FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY reporting_trade_owner ON public.trades FOR SELECT TO authenticated USING(live_strategy_id IN (SELECT id FROM public.live_strategies WHERE user_id=(SELECT auth.uid())));
CREATE POLICY reporting_portfolio_owner ON public.portfolio FOR SELECT TO authenticated USING(live_strategy_id IN (SELECT id FROM public.live_strategies WHERE user_id=(SELECT auth.uid())));
DO $$ DECLARE t text; BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['live_strategies','trades','portfolio'] LOOP
      IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- Sufficient trade statistics for the portable metric helper. No equity-history scan
-- is performed by the five-second worker refresh; full risk metrics use paged history.
CREATE OR REPLACE FUNCTION public.reporting_trade_aggregate(p_live_strategy_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT jsonb_build_object(
    'count',count(*),'wins',count(*) FILTER(WHERE net_pnl>0),'losses',count(*) FILTER(WHERE net_pnl<0),
    'pnl',coalesce(sum(net_pnl),0),'win_pnl',coalesce(sum(net_pnl) FILTER(WHERE net_pnl>0),0),
    'loss_pnl',coalesce(sum(net_pnl) FILTER(WHERE net_pnl<0),0),
    'largest_win',coalesce(max(net_pnl) FILTER(WHERE net_pnl>0),0),
    'largest_loss',min(net_pnl) FILTER(WHERE net_pnl<0),
    'commission',coalesce(sum(commission),0),'slippage',coalesce(sum(slippage),0),
    'holding_ms',avg(extract(epoch FROM ("exitTime"-"entryTime"))*1000) FILTER(WHERE "exitTime">="entryTime")
  ) FROM public.trades WHERE live_strategy_id=p_live_strategy_id;
$$;
REVOKE ALL ON FUNCTION public.reporting_trade_aggregate(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reporting_trade_aggregate(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.mark_reporting_changes() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  UPDATE public.live_strategies r SET metrics_context=r.metrics_context || jsonb_build_object(
    'refresh_pending',true,'data_revision',(coalesce((r.metrics_context->>'data_revision')::bigint,0)+1)::text,
    'finalization_pending',r.status IN ('completed','failed','cancelled') OR coalesce((r.metrics_context->>'finalization_pending')::boolean,false))
  WHERE r.mode='live' AND r.id IN (SELECT DISTINCT live_strategy_id FROM reporting_changed);
  RETURN NULL;
END $$;
CREATE TRIGGER reporting_trade_inserted AFTER INSERT ON public.trades REFERENCING NEW TABLE AS reporting_changed FOR EACH STATEMENT EXECUTE FUNCTION public.mark_reporting_changes();
CREATE TRIGGER reporting_trade_updated AFTER UPDATE ON public.trades REFERENCING NEW TABLE AS reporting_changed FOR EACH STATEMENT EXECUTE FUNCTION public.mark_reporting_changes();
CREATE TRIGGER reporting_snapshot_inserted AFTER INSERT ON public.portfolio REFERENCING NEW TABLE AS reporting_changed FOR EACH STATEMENT EXECUTE FUNCTION public.mark_reporting_changes();
CREATE TRIGGER reporting_snapshot_updated AFTER UPDATE ON public.portfolio REFERENCING NEW TABLE AS reporting_changed FOR EACH STATEMENT EXECUTE FUNCTION public.mark_reporting_changes();
CREATE INDEX live_strategies_pending_metrics ON public.live_strategies(id) WHERE mode='live' AND
  (metrics_updated_at IS NULL OR metrics_context->>'refresh_pending'='true' OR metrics_context->>'finalization_pending'='true');

-- Serialize resource cleanup across competing stop/delete requests. A process that
-- dies with a stop in progress retains ownership for explicit lifecycle recovery.
CREATE OR REPLACE FUNCTION public.claim_reporting_stop(p_user_id uuid,p_workflow_id uuid,p_execution_id uuid,p_token uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE w public.workflows; r public.live_strategies;
BEGIN
  SELECT * INTO STRICT w FROM public.workflows WHERE id=p_workflow_id AND user_id=p_user_id FOR UPDATE;
  IF NOT w.is_active OR w.active_execution_id IS DISTINCT FROM p_execution_id THEN RETURN false; END IF;
  SELECT * INTO STRICT r FROM public.live_strategies WHERE id=p_execution_id AND mode='live' AND user_id=p_user_id AND workflow_id=p_workflow_id FOR UPDATE;
  IF r.status='pending' THEN RAISE EXCEPTION 'Activation is still starting'; END IF;
  IF r.metrics_context ? 'stop_token' THEN RAISE EXCEPTION 'Activation stop is in progress'; END IF;
  UPDATE public.live_strategies SET metrics_context=metrics_context || jsonb_build_object('stop_token',p_token::text,'data_revision',(coalesce((metrics_context->>'data_revision')::bigint,0)+1)::text) WHERE id=r.id;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.release_reporting_stop(p_user_id uuid,p_workflow_id uuid,p_execution_id uuid,p_token uuid)
RETURNS void LANGUAGE sql SET search_path='' AS $$
  UPDATE public.live_strategies SET metrics_context=(metrics_context-'stop_token') || jsonb_build_object('data_revision',(coalesce((metrics_context->>'data_revision')::bigint,0)+1)::text)
    WHERE id=p_execution_id AND mode='live' AND user_id=p_user_id AND workflow_id=p_workflow_id AND metrics_context->>'stop_token'=p_token::text;
$$;
REVOKE ALL ON FUNCTION public.claim_reporting_stop(uuid,uuid,uuid,uuid),public.release_reporting_stop(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reporting_stop(uuid,uuid,uuid,uuid),public.release_reporting_stop(uuid,uuid,uuid,uuid) TO service_role;


-- Capture an explicitly supplied equity baseline once, tied to its account/currency.
CREATE OR REPLACE FUNCTION public.record_reporting_baseline(p_user_id uuid,p_workflow_id uuid,p_execution_id uuid,p_capital numeric,p_source jsonb)
RETURNS void LANGUAGE sql SET search_path='' AS $$
  UPDATE public.live_strategies SET initial_capital=p_capital,base_currency=p_source->>'base_currency',
    metrics_context=metrics_context || jsonb_build_object('initial_capital','recorded','snapshot_source',p_source,
      'refresh_pending',true,'data_revision',(coalesce((metrics_context->>'data_revision')::bigint,0)+1)::text)
  WHERE id=p_execution_id AND mode='live' AND user_id=p_user_id AND workflow_id=p_workflow_id
    AND status IN ('pending','running') AND initial_capital IS NULL AND p_capital>0
    AND (NOT(metrics_context ? 'snapshot_source') OR metrics_context->'snapshot_source'=p_source);
$$;
REVOKE ALL ON FUNCTION public.record_reporting_baseline(uuid,uuid,uuid,numeric,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_reporting_baseline(uuid,uuid,uuid,numeric,jsonb) TO service_role;

COMMENT ON COLUMN public.users.selected_markets IS
  'Dashboard market display IDs. NULL defaults to NYSE/NASDAQ; empty array means none. No trading subscription effects.';
COMMENT ON COLUMN public.portfolio.equity_open IS 'First observed portfolio equity in the UTC reporting day; not a security price.';
COMMENT ON COLUMN public.portfolio.equity_sample_count IS 'Distinct observed valuation timestamps in the UTC day. One observation produces a sparse doji.';

NOTIFY pgrst,'reload schema';
COMMIT;
