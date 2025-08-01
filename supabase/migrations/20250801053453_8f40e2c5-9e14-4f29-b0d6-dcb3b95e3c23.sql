-- Add persistent_state column to workflows table for cross-run field persistence
ALTER TABLE public.workflows 
ADD COLUMN persistent_state JSONB DEFAULT '{}'::jsonb;