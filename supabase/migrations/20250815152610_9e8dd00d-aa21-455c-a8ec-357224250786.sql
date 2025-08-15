-- Add user-level RLS policies for user_credentials table
-- This ensures users can only access their own credentials

-- Add policy for users to view their own credentials
CREATE POLICY "Users can view their own credentials" 
ON public.user_credentials 
FOR SELECT 
USING (auth.uid() = user_id);

-- Add policy for users to insert their own credentials  
CREATE POLICY "Users can create their own credentials"
ON public.user_credentials
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Add policy for users to update their own credentials
CREATE POLICY "Users can update their own credentials"
ON public.user_credentials
FOR UPDATE
USING (auth.uid() = user_id);

-- Add policy for users to delete their own credentials
CREATE POLICY "Users can delete their own credentials"
ON public.user_credentials
FOR DELETE
USING (auth.uid() = user_id);