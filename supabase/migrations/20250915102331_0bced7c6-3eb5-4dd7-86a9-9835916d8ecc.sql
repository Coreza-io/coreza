-- Coreza Trading Platform Database Schema
-- This file contains all the necessary database objects for the platform

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table for extended user profiles
CREATE TABLE IF NOT EXISTS public.users (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid UNIQUE,
    first_name character varying NOT NULL,
    last_name character varying NOT NULL,
    phone text,
    location text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

-- Create projects table
CREATE TABLE IF NOT EXISTS public.projects (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'active'::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create workflows table
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
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Create workflow_runs table
CREATE TABLE IF NOT EXISTS public.workflow_runs (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workflow_id uuid NOT NULL,
    initiated_by uuid,
    status text NOT NULL,
    result jsonb,
    started_at timestamp with time zone NOT NULL DEFAULT now(),
    completed_at timestamp with time zone,
    error_message text
);

-- Create node_executions table
CREATE TABLE IF NOT EXISTS public.node_executions (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id uuid NOT NULL,
    node_id text NOT NULL,
    status text NOT NULL,
    input_payload jsonb NOT NULL,
    output_payload jsonb,
    error_message text,
    started_at timestamp with time zone NOT NULL DEFAULT now(),
    finished_at timestamp with time zone
);

-- Create user_credentials table with encryption support
CREATE TABLE IF NOT EXISTS public.user_credentials (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL,
    service_type text NOT NULL,
    name text NOT NULL,
    scopes text,
    client_json jsonb DEFAULT '{}'::jsonb,
    token_json jsonb DEFAULT '{}'::jsonb,
    key_ref text DEFAULT 'env:v1'::text,
    is_encrypted boolean DEFAULT false,
    enc_version smallint DEFAULT 1,
    key_algo text DEFAULT 'AES-256-GCM'::text,
    enc_payload bytea,
    iv bytea,
    auth_tag bytea,
    dek_wrapped bytea,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Create backtests table
CREATE TABLE IF NOT EXISTS public.backtests (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    start_date date NOT NULL,
    end_date date NOT NULL,
    initial_capital numeric NOT NULL DEFAULT 10000.00,
    commission_rate numeric DEFAULT 0.001,
    slippage_rate numeric DEFAULT 0.001,
    data_frequency text NOT NULL DEFAULT '1d'::text,
    status text NOT NULL DEFAULT 'pending'::text,
    error_message text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone
);

-- Create backtest_results table
CREATE TABLE IF NOT EXISTS public.backtest_results (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    backtest_id uuid NOT NULL,
    total_return numeric,
    annualized_return numeric,
    max_drawdown numeric,
    sharpe_ratio numeric,
    win_rate numeric,
    total_trades integer,
    profitable_trades integer,
    average_trade_return numeric,
    largest_win numeric,
    largest_loss numeric,
    final_portfolio_value numeric,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create backtest_trades table
CREATE TABLE IF NOT EXISTS public.backtest_trades (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    backtest_id uuid NOT NULL,
    timestamp timestamp with time zone NOT NULL,
    symbol text NOT NULL,
    action text NOT NULL,
    quantity numeric NOT NULL,
    price numeric NOT NULL,
    commission numeric,
    slippage numeric,
    portfolio_value_before numeric,
    portfolio_value_after numeric,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create backtest_portfolio_snapshots table
CREATE TABLE IF NOT EXISTS public.backtest_portfolio_snapshots (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    backtest_id uuid NOT NULL,
    date date NOT NULL,
    total_value numeric NOT NULL,
    stock_value numeric NOT NULL,
    cash_balance numeric NOT NULL,
    daily_return numeric,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable Row Level Security on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtest_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtest_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtest_portfolio_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
CREATE POLICY "Users can view their own profile" ON public.users FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own profile" ON public.users FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own profile" ON public.users FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for projects table
CREATE POLICY "Users can view their own projects" ON public.projects FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own projects" ON public.projects FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own projects" ON public.projects FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own projects" ON public.projects FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for workflows table
CREATE POLICY "Users can view their own workflows" ON public.workflows FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own workflows" ON public.workflows FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own workflows" ON public.workflows FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own workflows" ON public.workflows FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for workflow_runs table
CREATE POLICY "Users can view runs of their own workflows" ON public.workflow_runs FOR SELECT USING (auth.uid() IN (SELECT user_id FROM workflows WHERE id = workflow_runs.workflow_id));
CREATE POLICY "Users can create runs for their own workflows" ON public.workflow_runs FOR INSERT WITH CHECK (auth.uid() IN (SELECT user_id FROM workflows WHERE id = workflow_runs.workflow_id));

-- RLS Policies for node_executions table
CREATE POLICY "Users can view executions of their own workflow runs" ON public.node_executions FOR SELECT USING (auth.uid() IN (SELECT w.user_id FROM workflows w JOIN workflow_runs wr ON w.id = wr.workflow_id WHERE wr.id = node_executions.run_id));
CREATE POLICY "Users can create executions for their own workflow runs" ON public.node_executions FOR INSERT WITH CHECK (auth.uid() IN (SELECT w.user_id FROM workflows w JOIN workflow_runs wr ON w.id = wr.workflow_id WHERE wr.id = node_executions.run_id));

-- RLS Policies for user_credentials table
CREATE POLICY "Users can view their own credentials" ON public.user_credentials FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own credentials" ON public.user_credentials FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own credentials" ON public.user_credentials FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own credentials" ON public.user_credentials FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access" ON public.user_credentials FOR ALL USING (auth.role() = 'service_role') WITH CHECK (true);

-- RLS Policies for backtests table
CREATE POLICY "Users can view their own backtests" ON public.backtests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own backtests" ON public.backtests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own backtests" ON public.backtests FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own backtests" ON public.backtests FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for backtest_results table
CREATE POLICY "Users can view results of their own backtests" ON public.backtest_results FOR SELECT USING (auth.uid() IN (SELECT user_id FROM backtests WHERE id = backtest_results.backtest_id));
CREATE POLICY "Users can create results for their own backtests" ON public.backtest_results FOR INSERT WITH CHECK (auth.uid() IN (SELECT user_id FROM backtests WHERE id = backtest_results.backtest_id));

-- RLS Policies for backtest_trades table
CREATE POLICY "Users can view trades of their own backtests" ON public.backtest_trades FOR SELECT USING (auth.uid() IN (SELECT user_id FROM backtests WHERE id = backtest_trades.backtest_id));
CREATE POLICY "Users can create trades for their own backtests" ON public.backtest_trades FOR INSERT WITH CHECK (auth.uid() IN (SELECT user_id FROM backtests WHERE id = backtest_trades.backtest_id));

-- RLS Policies for backtest_portfolio_snapshots table
CREATE POLICY "Users can view portfolio snapshots of their own backtests" ON public.backtest_portfolio_snapshots FOR SELECT USING (auth.uid() IN (SELECT user_id FROM backtests WHERE id = backtest_portfolio_snapshots.backtest_id));
CREATE POLICY "Users can create portfolio snapshots for their own backtests" ON public.backtest_portfolio_snapshots FOR INSERT WITH CHECK (auth.uid() IN (SELECT user_id FROM backtests WHERE id = backtest_portfolio_snapshots.backtest_id));

-- Create function to update updated_at columns
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create function for user_credentials updated_at
CREATE OR REPLACE FUNCTION public.user_credentials_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- Create function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (user_id, first_name, last_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Create triggers for updated_at columns
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_workflows_updated_at
  BEFORE UPDATE ON public.workflows
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER user_credentials_updated_at
  BEFORE UPDATE ON public.user_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.user_credentials_set_updated_at();

-- Create trigger for new user creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();