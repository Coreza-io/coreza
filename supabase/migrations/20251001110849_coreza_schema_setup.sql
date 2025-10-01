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
    started_at timestamp with time zone NOT NULL DEFAULT now(),
    completed_at timestamp with time zone,
    result jsonb,
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
    started_at timestamp with time zone NOT NULL DEFAULT now(),
    finished_at timestamp with time zone,
    error_message text
);

-- Create user_credentials table for encrypted credential storage
CREATE TABLE IF NOT EXISTS public.user_credentials (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL,
    service_type text NOT NULL,
    name text NOT NULL,
    enc_payload bytea,
    iv bytea,
    auth_tag bytea,
    dek_wrapped bytea,
    is_encrypted boolean DEFAULT false,
    enc_version smallint DEFAULT 1,
    key_algo text DEFAULT 'AES-256-GCM'::text,
    key_ref text DEFAULT 'env:v1'::text,
    scopes text,
    client_json jsonb DEFAULT '{}'::jsonb,
    token_json jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Enable Row Level Security on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own profile" ON public.users
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile" ON public.users
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile" ON public.users
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own projects" ON public.projects
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own projects" ON public.projects
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own projects" ON public.projects
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own projects" ON public.projects
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own workflows" ON public.workflows
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own workflows" ON public.workflows
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own workflows" ON public.workflows
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own workflows" ON public.workflows
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view runs of their own workflows" ON public.workflow_runs
    FOR SELECT USING (auth.uid() IN (
        SELECT workflows.user_id FROM workflows WHERE workflows.id = workflow_runs.workflow_id
    ));

CREATE POLICY "Users can create runs for their own workflows" ON public.workflow_runs
    FOR INSERT WITH CHECK (auth.uid() IN (
        SELECT workflows.user_id FROM workflows WHERE workflows.id = workflow_runs.workflow_id
    ));

CREATE POLICY "Users can view executions of their own workflow runs" ON public.node_executions
    FOR SELECT USING (auth.uid() IN (
        SELECT w.user_id FROM workflows w
        JOIN workflow_runs wr ON w.id = wr.workflow_id
        WHERE wr.id = node_executions.run_id
    ));

CREATE POLICY "Users can create executions for their own workflow runs" ON public.node_executions
    FOR INSERT WITH CHECK (auth.uid() IN (
        SELECT w.user_id FROM workflows w
        JOIN workflow_runs wr ON w.id = wr.workflow_id
        WHERE wr.id = node_executions.run_id
    ));

CREATE POLICY "Users can view their own credentials" ON public.user_credentials
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own credentials" ON public.user_credentials
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own credentials" ON public.user_credentials
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own credentials" ON public.user_credentials
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Service role full access" ON public.user_credentials
    FOR ALL USING (auth.role() = 'service_role'::text) WITH CHECK (true);

-- Utility functions
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
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
        COALESCE(NEW.raw_user_meta_data->>'last_name', '')
    );
    RETURN NEW;
END;
$$;

-- Triggers (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_projects_updated_at') THEN
    CREATE TRIGGER update_projects_updated_at
        BEFORE UPDATE ON public.projects
        FOR EACH ROW
        EXECUTE FUNCTION public.update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_workflows_updated_at') THEN
    CREATE TRIGGER update_workflows_updated_at
        BEFORE UPDATE ON public.workflows
        FOR EACH ROW
        EXECUTE FUNCTION public.update_updated_at_column();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_credentials_updated_at') THEN
    CREATE TRIGGER update_user_credentials_updated_at
        BEFORE UPDATE ON public.user_credentials
        FOR EACH ROW
        EXECUTE FUNCTION public.user_credentials_set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
        AFTER INSERT ON auth.users
        FOR EACH ROW
        EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;
