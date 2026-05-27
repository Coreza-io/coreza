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
  node_count integer,
  edge_count integer,
  schedule_key text,
  execution_id uuid DEFAULT NULL,
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

CREATE TABLE IF NOT EXISTS public.backtest_results (
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

CREATE TABLE IF NOT EXISTS public.backtest_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backtest_id uuid NOT NULL REFERENCES public.backtests(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  action text NOT NULL,
  quantity numeric NOT NULL,
  entryPrice numeric,
  exitPrice numeric NOT NULL,
  entryTime timestamptz,
  exitTime timestamptz NOT NULL,
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

CREATE TABLE IF NOT EXISTS public.backtest_portfolio_snapshots (
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
  entryPrice numeric,
  exitPrice numeric NOT NULL,
  entryTime timestamptz,
  exitTime timestamptz NOT NULL,
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
ALTER TABLE public.backtest_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtest_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtest_portfolio_snapshots ENABLE ROW LEVEL SECURITY;
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
DROP POLICY IF EXISTS "Users can view results of own backtests" ON public.backtest_results;
CREATE POLICY "Users can view results of own backtests" ON public.backtest_results
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.backtests b WHERE b.id = backtest_results.backtest_id AND b.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can insert results of own backtests" ON public.backtest_results;
CREATE POLICY "Users can insert results of own backtests" ON public.backtest_results
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.backtests b WHERE b.id = backtest_results.backtest_id AND b.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view trades of own backtests" ON public.backtest_trades;
CREATE POLICY "Users can view trades of own backtests" ON public.backtest_trades
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.backtests b WHERE b.id = backtest_trades.backtest_id AND b.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can insert trades of own backtests" ON public.backtest_trades;
CREATE POLICY "Users can insert trades of own backtests" ON public.backtest_trades
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.backtests b WHERE b.id = backtest_trades.backtest_id AND b.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can view snapshots of own backtests" ON public.backtest_portfolio_snapshots;
CREATE POLICY "Users can view snapshots of own backtests" ON public.backtest_portfolio_snapshots
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.backtests b WHERE b.id = backtest_portfolio_snapshots.backtest_id AND b.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can insert snapshots of own backtests" ON public.backtest_portfolio_snapshots;
CREATE POLICY "Users can insert snapshots of own backtests" ON public.backtest_portfolio_snapshots
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.backtests b WHERE b.id = backtest_portfolio_snapshots.backtest_id AND b.user_id = auth.uid()));

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
