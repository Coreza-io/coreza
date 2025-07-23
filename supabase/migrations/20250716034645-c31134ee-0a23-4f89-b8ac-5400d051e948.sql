-- Enable Row Level Security on all public tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_executions ENABLE ROW LEVEL SECURITY;

-- Drop the custom users table since we'll use Supabase Auth
-- First, let's create a profiles table for additional user data
CREATE TABLE public.profiles (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  first_name text,
  last_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for profiles
CREATE POLICY "Users can view their own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile" 
ON public.profiles 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Update workflows table to use auth.users
ALTER TABLE public.workflows 
ALTER COLUMN user_id SET NOT NULL;

-- Create RLS policies for workflows
CREATE POLICY "Users can view their own workflows" 
ON public.workflows 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own workflows" 
ON public.workflows 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own workflows" 
ON public.workflows 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own workflows" 
ON public.workflows 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create RLS policies for projects
CREATE POLICY "Users can view their own projects" 
ON public.projects 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own projects" 
ON public.projects 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own projects" 
ON public.projects 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own projects" 
ON public.projects 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create RLS policies for workflow_runs
CREATE POLICY "Users can view runs of their own workflows" 
ON public.workflow_runs 
FOR SELECT 
USING (
  auth.uid() IN (
    SELECT user_id FROM public.workflows WHERE id = workflow_runs.workflow_id
  )
);

CREATE POLICY "Users can create runs for their own workflows" 
ON public.workflow_runs 
FOR INSERT 
WITH CHECK (
  auth.uid() IN (
    SELECT user_id FROM public.workflows WHERE id = workflow_runs.workflow_id
  )
);

-- Create RLS policies for node_executions
CREATE POLICY "Users can view executions of their own workflow runs" 
ON public.node_executions 
FOR SELECT 
USING (
  auth.uid() IN (
    SELECT w.user_id 
    FROM public.workflows w 
    JOIN public.workflow_runs wr ON w.id = wr.workflow_id 
    WHERE wr.id = node_executions.run_id
  )
);

CREATE POLICY "Users can create executions for their own workflow runs" 
ON public.node_executions 
FOR INSERT 
WITH CHECK (
  auth.uid() IN (
    SELECT w.user_id 
    FROM public.workflows w 
    JOIN public.workflow_runs wr ON w.id = wr.workflow_id 
    WHERE wr.id = node_executions.run_id
  )
);

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, first_name, last_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new user signups
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update triggers for profiles timestamps
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();