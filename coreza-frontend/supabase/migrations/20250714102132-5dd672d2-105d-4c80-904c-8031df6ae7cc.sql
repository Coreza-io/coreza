-- Enable Row Level Security on workflows table
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to view their own workflows
CREATE POLICY "Users can view their own workflows" 
ON public.workflows 
FOR SELECT 
USING (user_id = auth.uid()::text);

-- Create policy to allow users to create their own workflows
CREATE POLICY "Users can create their own workflows" 
ON public.workflows 
FOR INSERT 
WITH CHECK (user_id = auth.uid()::text);

-- Create policy to allow users to update their own workflows
CREATE POLICY "Users can update their own workflows" 
ON public.workflows 
FOR UPDATE 
USING (user_id = auth.uid()::text);

-- Create policy to allow users to delete their own workflows
CREATE POLICY "Users can delete their own workflows" 
ON public.workflows 
FOR DELETE 
USING (user_id = auth.uid()::text);