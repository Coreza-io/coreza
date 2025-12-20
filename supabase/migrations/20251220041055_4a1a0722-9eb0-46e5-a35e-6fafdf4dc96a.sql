-- Create workflow_versions table for version history
CREATE TABLE public.workflow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  nodes JSONB NOT NULL,
  edges JSONB NOT NULL,
  is_active BOOLEAN DEFAULT false,
  node_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  change_description TEXT,
  
  CONSTRAINT unique_workflow_version UNIQUE(workflow_id, version_number)
);

-- Index for fast lookups
CREATE INDEX idx_workflow_versions_workflow_id ON public.workflow_versions(workflow_id);
CREATE INDEX idx_workflow_versions_created_at ON public.workflow_versions(workflow_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.workflow_versions ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can view versions of their own workflows
CREATE POLICY "Users can view their workflow versions"
  ON public.workflow_versions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workflows 
      WHERE workflows.id = workflow_versions.workflow_id 
      AND workflows.user_id = auth.uid()
    )
  );

-- RLS policy: Users can insert versions for their own workflows
CREATE POLICY "Users can insert their workflow versions"
  ON public.workflow_versions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workflows 
      WHERE workflows.id = workflow_versions.workflow_id 
      AND workflows.user_id = auth.uid()
    )
  );

-- RLS policy: Users can delete versions of their own workflows
CREATE POLICY "Users can delete their workflow versions"
  ON public.workflow_versions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.workflows 
      WHERE workflows.id = workflow_versions.workflow_id 
      AND workflows.user_id = auth.uid()
    )
  );