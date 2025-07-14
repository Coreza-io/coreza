-- Disable Row Level Security on workflows table since we're using custom authentication
ALTER TABLE public.workflows DISABLE ROW LEVEL SECURITY;

-- Drop the existing policies
DROP POLICY IF EXISTS "Users can view their own workflows" ON public.workflows;
DROP POLICY IF EXISTS "Users can create their own workflows" ON public.workflows;
DROP POLICY IF EXISTS "Users can update their own workflows" ON public.workflows;
DROP POLICY IF EXISTS "Users can delete their own workflows" ON public.workflows;