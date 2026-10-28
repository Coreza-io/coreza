-- Coreza Trading Platform Database Schema

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
  CONSTRAINT idx_workflow_runs_schedule_key_unique UNIQUE NULLS NOT DISTINCT (workflow_id, schedule_key)
);

CREATE TABLE IF NOT EXISTS public.node_executions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  status text NOT NULL,
  input_payload jsonb NOT NULL,
  output_payload jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error_message text
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

CREATE TABLE IF NOT EXISTS public.live_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_id uuid NOT NULL REFERENCES public.backtests(id) ON DELETE CASCADE,
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
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_id uuid NOT NULL REFERENCES public.backtests(id) ON DELETE CASCADE,
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
  portfolio_value_before numeric,
  portfolio_value_after numeric,
  holding_period_bars integer,
  exit_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.portfolio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_id uuid NOT NULL REFERENCES public.backtests(id) ON DELETE CASCADE,
  date date NOT NULL,
  total_value numeric NOT NULL,
  cash_balance numeric NOT NULL,
  stock_value numeric NOT NULL,
  daily_return numeric,
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
  timeInForce text,
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

CREATE TABLE IF NOT EXISTS public.live_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid,
  execution_id uuid,
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  action text NOT NULL,
  quantity numeric NOT NULL,
  "entryPrice" numeric,
  "exitPrice" numeric NOT NULL,
  "entryTime" timestamptz,
  "exitTime" timestamptz NOT NULL,
  entry_order_id text,
  exit_order_id text,
  commission numeric,
  slippage numeric,
  gross_pnl numeric,
  net_pnl numeric,
  holding_period_bars integer,
  exit_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cash_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workflow_id uuid,
  execution_id uuid,
  broker text NOT NULL,
  credential_id uuid NOT NULL,
  snapshot_at timestamptz NOT NULL,
  base_currency text,
  balances jsonb NOT NULL DEFAULT '{}'::jsonb,
  cash numeric,
  equity numeric,
  positions_count integer,
  unrealized_pnl numeric,
  realized_pnl numeric,
  total_value_usdt numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.position_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  broker text NOT NULL,
  symbol text NOT NULL,
  quantity numeric NOT NULL,
  avg_entry_price numeric NOT NULL,
  current_price numeric,
  unrealized_pnl numeric,
  realized_pnl numeric,
  snapshot_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);


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
CREATE INDEX IF NOT EXISTS idx_live_trades_workflow ON public.live_trades(workflow_id, execution_id);
CREATE INDEX IF NOT EXISTS idx_live_trades_user ON public.live_trades(user_id, workflow_id);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_fills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.position_snapshots ENABLE ROW LEVEL SECURITY;

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

-- Workflow runs and node executions
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

DROP POLICY IF EXISTS "Users can view executions of their own workflow runs" ON public.node_executions;
CREATE POLICY "Users can view executions of their own workflow runs" ON public.node_executions
  FOR SELECT USING (
    auth.uid() IN (
      SELECT w.user_id FROM public.workflows w
      JOIN public.workflow_runs wr ON w.id = wr.workflow_id
      WHERE wr.id = node_executions.run_id
    )
  );
DROP POLICY IF EXISTS "Users can create executions for their own workflow runs" ON public.node_executions;
CREATE POLICY "Users can create executions for their own workflow runs" ON public.node_executions
  FOR INSERT WITH CHECK (
    auth.uid() IN (
      SELECT w.user_id FROM public.workflows w
      JOIN public.workflow_runs wr ON w.id = wr.workflow_id
      WHERE wr.id = node_executions.run_id
    )
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

-- Backtest child tables
DROP POLICY IF EXISTS "Users can view results of own backtests" ON public.live_strategies;
CREATE POLICY "Users can view results of own backtests" ON public.live_strategies
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.backtests b WHERE b.id = live_strategies.backtest_id AND b.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can insert results of own backtests" ON public.live_strategies;
CREATE POLICY "Users can insert results of own backtests" ON public.live_strategies
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.backtests b WHERE b.id = live_strategies.backtest_id AND b.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view trades of own backtests" ON public.trades;
CREATE POLICY "Users can view trades of own backtests" ON public.trades
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.backtests b WHERE b.id = trades.backtest_id AND b.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can insert trades of own backtests" ON public.trades;
CREATE POLICY "Users can insert trades of own backtests" ON public.trades
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.backtests b WHERE b.id = trades.backtest_id AND b.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view snapshots of own backtests" ON public.portfolio;
CREATE POLICY "Users can view snapshots of own backtests" ON public.portfolio
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.backtests b WHERE b.id = portfolio.backtest_id AND b.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can insert snapshots of own backtests" ON public.portfolio;
CREATE POLICY "Users can insert snapshots of own backtests" ON public.portfolio
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.backtests b WHERE b.id = portfolio.backtest_id AND b.user_id = auth.uid()));

-- Live-trading state tables
DROP POLICY IF EXISTS "Users can manage own live fills" ON public.live_fills;
CREATE POLICY "Users can manage own live fills" ON public.live_fills FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can manage own live trades" ON public.live_trades;
CREATE POLICY "Users can manage own live trades" ON public.live_trades FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can manage own cash snapshots" ON public.cash_snapshots;
CREATE POLICY "Users can manage own cash snapshots" ON public.cash_snapshots FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can manage own position snapshots" ON public.position_snapshots;
CREATE POLICY "Users can manage own position snapshots" ON public.position_snapshots FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- (existing workflow/workflow_runs/node_executions/user_credentials policies retained)
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

-- Shared reporting schema and lifecycle cutover
-- Coordinated cutover: pause starts/writers and drain before applying; deploy readers
-- and writers together. This migration never stops or restarts a trading strategy.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.live_strategies') IS NULL THEN
    ALTER TABLE public.backtest_results RENAME TO live_strategies;
    ALTER TABLE public.backtest_trades RENAME TO trades;
    ALTER TABLE public.backtest_portfolio_snapshots RENAME TO portfolio;
  END IF;
END $$;

ALTER TABLE public.live_strategies
  ALTER COLUMN backtest_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'backtest',
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS workflow_id uuid REFERENCES public.workflows(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS execution_id uuid,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS source_workflow_revision bigint,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS initial_capital numeric,
  ADD COLUMN IF NOT EXISTS base_currency text,
  ADD COLUMN IF NOT EXISTS metrics_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metrics_context jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Refuse ambiguous legacy summaries instead of dropping or merging financial rows.
CREATE UNIQUE INDEX IF NOT EXISTS live_strategies_backtest ON public.live_strategies(backtest_id);
CREATE UNIQUE INDEX IF NOT EXISTS live_strategies_execution ON public.live_strategies(execution_id);
UPDATE public.live_strategies r SET user_id=b.user_id, workflow_id=b.workflow_id,
  name=b.name, status=b.status, started_at=b.started_at, completed_at=b.completed_at,
  error_message=b.error_message, initial_capital=b.initial_capital,
  metrics_context='{"source":"backtest","granularity":"daily","average_trade_return_unit":"currency","avg_holding_period_unit":"bars"}'
FROM public.backtests b WHERE r.backtest_id=b.id;
INSERT INTO public.live_strategies(backtest_id,user_id,workflow_id,name,status,started_at,completed_at,error_message,initial_capital,created_at,metrics_context)
SELECT b.id,b.user_id,b.workflow_id,b.name,b.status,b.started_at,b.completed_at,b.error_message,b.initial_capital,b.created_at,
  '{"source":"backtest","granularity":"daily","average_trade_return_unit":"currency","avg_holding_period_unit":"bars"}'::jsonb
FROM public.backtests b WHERE NOT EXISTS (SELECT 1 FROM public.live_strategies r WHERE r.backtest_id=b.id);

ALTER TABLE public.trades
  ALTER COLUMN backtest_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS live_strategy_id uuid REFERENCES public.live_strategies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS workflow_id uuid,
  ADD COLUMN IF NOT EXISTS execution_id uuid,
  ADD COLUMN IF NOT EXISTS gross_pnl numeric,
  ADD COLUMN IF NOT EXISTS entry_order_id text,
  ADD COLUMN IF NOT EXISTS exit_order_id text;
ALTER TABLE public.portfolio
  ALTER COLUMN backtest_id DROP NOT NULL,
  ALTER COLUMN date DROP NOT NULL,
  ALTER COLUMN total_value DROP NOT NULL,
  ALTER COLUMN cash_balance DROP NOT NULL,
  ALTER COLUMN stock_value DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS live_strategy_id uuid REFERENCES public.live_strategies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS workflow_id uuid,
  ADD COLUMN IF NOT EXISTS execution_id uuid,
  ADD COLUMN IF NOT EXISTS snapshot_at timestamptz,
  ADD COLUMN IF NOT EXISTS broker text,
  ADD COLUMN IF NOT EXISTS credential_id uuid,
  ADD COLUMN IF NOT EXISTS base_currency text,
  ADD COLUMN IF NOT EXISTS balances jsonb,
  ADD COLUMN IF NOT EXISTS cash numeric,
  ADD COLUMN IF NOT EXISTS equity numeric,
  ADD COLUMN IF NOT EXISTS realized_pnl numeric,
  ADD COLUMN IF NOT EXISTS unrealized_pnl numeric,
  ADD COLUMN IF NOT EXISTS positions_count integer,
  ADD COLUMN IF NOT EXISTS total_value_usdt numeric;
UPDATE public.trades c SET live_strategy_id=r.id,user_id=r.user_id,workflow_id=r.workflow_id
FROM public.live_strategies r WHERE c.backtest_id=r.backtest_id;
UPDATE public.portfolio c SET live_strategy_id=r.id,user_id=r.user_id,workflow_id=r.workflow_id
FROM public.live_strategies r WHERE c.backtest_id=r.backtest_id;

-- Only reliable, owned activation groups qualify. Technical event run IDs do not.
CREATE TEMP TABLE reporting_legacy_activations ON COMMIT DROP AS
WITH evidence AS (
  SELECT workflow_id,user_id,execution_id,"entryTime" AS observed_at FROM public.live_trades
  UNION ALL SELECT workflow_id,user_id,execution_id,snapshot_at FROM public.cash_snapshots
  UNION ALL SELECT id,user_id,active_execution_id,NULL::timestamptz FROM public.workflows WHERE is_active
  UNION ALL SELECT workflow_id,initiated_by,execution_id,started_at FROM public.workflow_runs WHERE execution_id IS NOT NULL AND execution_id<>id
)
SELECT e.workflow_id,e.user_id,e.execution_id,min(e.observed_at) AS first_observed_at
FROM evidence e JOIN public.workflows w ON w.id=e.workflow_id AND w.user_id=e.user_id
WHERE e.execution_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.nodes)='array' THEN w.nodes ELSE '[]'::jsonb END) n
  WHERE lower(coalesce(n->>'type',n->>'name',n->>'def',n->>'node_type',''))='portfolio'
    AND coalesce(n#>>'{values,mode}',n#>>'{data,values,mode}',n#>>'{data,config,mode}',n#>>'{data,mode}')='broker'
)
GROUP BY e.workflow_id,e.user_id,e.execution_id;
DO $$ BEGIN
  IF EXISTS (SELECT execution_id FROM reporting_legacy_activations GROUP BY execution_id HAVING count(*)>1)
    OR EXISTS (SELECT 1 FROM reporting_legacy_activations a JOIN public.live_strategies r ON r.id=a.execution_id
      WHERE r.mode<>'live' OR r.execution_id IS DISTINCT FROM a.execution_id OR r.workflow_id<>a.workflow_id OR r.user_id<>a.user_id)
  THEN RAISE EXCEPTION 'Conflicting reporting activation UUID; reconcile before cutover'; END IF;
END $$;
INSERT INTO public.live_strategies(id,mode,user_id,workflow_id,execution_id,name,status,started_at,metrics_context)
SELECT a.execution_id,'live',a.user_id,a.workflow_id,a.execution_id,w.name,
  CASE WHEN w.is_active AND w.active_execution_id=a.execution_id THEN 'running' ELSE 'cancelled' END,
  a.first_observed_at,
  jsonb_build_object('source','live','granularity','intraday','legacy',true,
    'lifecycle_unknown',NOT(w.is_active AND w.active_execution_id=a.execution_id),
    'started_at_inferred',true,'initial_capital','unavailable',
    'average_trade_return_unit','percent','avg_holding_period_unit','milliseconds')
FROM reporting_legacy_activations a JOIN public.workflows w ON w.id=a.workflow_id
ON CONFLICT (execution_id) DO NOTHING;

-- Source UUIDs are retry identities. Never deduplicate partial exits by order/time.
INSERT INTO public.trades(id,live_strategy_id,user_id,workflow_id,execution_id,symbol,action,quantity,
  "entryPrice","exitPrice","entryTime","exitTime",commission,slippage,net_pnl,gross_pnl,entry_order_id,exit_order_id,holding_period_bars,exit_reason,created_at)
SELECT t.id,r.id,t.user_id,t.workflow_id,t.execution_id,t.symbol,t.action,t.quantity,
  t."entryPrice",t."exitPrice",t."entryTime",t."exitTime",t.commission,t.slippage,t.net_pnl,t.gross_pnl,t.entry_order_id,t.exit_order_id,t.holding_period_bars,t.exit_reason,t.created_at
FROM public.live_trades t JOIN public.live_strategies r ON r.execution_id=t.execution_id AND r.workflow_id=t.workflow_id AND r.user_id=t.user_id AND r.mode='live';
INSERT INTO public.portfolio(id,live_strategy_id,user_id,workflow_id,execution_id,snapshot_at,broker,credential_id,base_currency,balances,cash,equity,realized_pnl,unrealized_pnl,positions_count,total_value_usdt,created_at)
SELECT c.id,r.id,c.user_id,c.workflow_id,c.execution_id,c.snapshot_at,c.broker,c.credential_id,c.base_currency,c.balances,c.cash,c.equity,c.realized_pnl,c.unrealized_pnl,c.positions_count,c.total_value_usdt,c.created_at
FROM public.cash_snapshots c JOIN public.live_strategies r ON r.execution_id=c.execution_id AND r.workflow_id=c.workflow_id AND r.user_id=c.user_id AND r.mode='live';

ALTER TABLE public.live_strategies ALTER COLUMN user_id SET NOT NULL, ALTER COLUMN workflow_id SET NOT NULL, ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.live_strategies ADD CONSTRAINT reporting_mode_identity CHECK (
  (mode='backtest' AND backtest_id IS NOT NULL AND execution_id IS NULL) OR
  (mode='live' AND backtest_id IS NULL AND execution_id IS NOT NULL AND id=execution_id));
ALTER TABLE public.live_strategies ADD CONSTRAINT reporting_status CHECK (status IN ('pending','running','completed','failed','cancelled'));
ALTER TABLE public.trades ALTER COLUMN live_strategy_id SET NOT NULL, ALTER COLUMN user_id SET NOT NULL, ALTER COLUMN workflow_id SET NOT NULL;
ALTER TABLE public.portfolio ALTER COLUMN live_strategy_id SET NOT NULL, ALTER COLUMN user_id SET NOT NULL, ALTER COLUMN workflow_id SET NOT NULL;
CREATE INDEX live_strategies_owner_mode_start ON public.live_strategies(user_id,mode,started_at DESC,id DESC);
CREATE INDEX live_strategies_owner_mode_status ON public.live_strategies(user_id,mode,status);
CREATE INDEX trades_strategy_exit ON public.trades(live_strategy_id,"exitTime",id);
CREATE INDEX portfolio_strategy_snapshot ON public.portfolio(live_strategy_id,snapshot_at,id);
CREATE UNIQUE INDEX portfolio_strategy_date ON public.portfolio(live_strategy_id,date);
CREATE UNIQUE INDEX portfolio_snapshot_retry ON public.portfolio(live_strategy_id,broker,credential_id,snapshot_at);

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
       (NEW.backtest_id IS NOT NULL AND NEW.backtest_id IS DISTINCT FROM parent.backtest_id) OR
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

-- Remove legacy policies after rename: child access follows the owned parent only.
DO $$ DECLARE p record; t text; BEGIN
  FOR p IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('live_strategies','trades','portfolio') LOOP
    EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,p.tablename);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['live_strategies','trades','portfolio'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  END LOOP;
END $$;
CREATE POLICY reporting_owner ON public.live_strategies FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY reporting_trade_owner ON public.trades FOR SELECT TO authenticated USING(live_strategy_id IN (SELECT id FROM public.live_strategies WHERE user_id=(SELECT auth.uid())));
CREATE POLICY reporting_portfolio_owner ON public.portfolio FOR SELECT TO authenticated USING(live_strategy_id IN (SELECT id FROM public.live_strategies WHERE user_id=(SELECT auth.uid())));
-- Old live tables remain rollback sources; account-level cash snapshots remain operational.
REVOKE INSERT,UPDATE,DELETE ON public.live_trades FROM authenticated;
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

NOTIFY pgrst,'reload schema';
COMMIT;
