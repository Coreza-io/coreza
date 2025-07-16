-- Add RLS policy for users table (only needed for legacy data cleanup)
CREATE POLICY "Users can only see themselves" 
ON public.users 
FOR SELECT 
USING (auth.uid()::text = id::text);

-- Fix function search paths for security
ALTER FUNCTION public.handle_new_user() SET search_path = '';
ALTER FUNCTION public.update_updated_at_column() SET search_path = '';
ALTER FUNCTION public.user_credentials_set_updated_at() SET search_path = '';