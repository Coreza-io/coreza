-- First, drop the profiles table and related policies
DROP TABLE IF EXISTS public.profiles CASCADE;

-- Modify the existing users table to work with Supabase Auth
-- Remove the insecure fields and add user_id linking to auth.users
ALTER TABLE public.users DROP COLUMN IF EXISTS password_hash;
ALTER TABLE public.users DROP COLUMN IF EXISTS email;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE;

-- Update RLS policies for users table to use auth.uid()
DROP POLICY IF EXISTS "Users can only see themselves" ON public.users;

CREATE POLICY "Users can view their own profile" 
ON public.users 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile" 
ON public.users 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile" 
ON public.users 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Update the trigger function to insert into users table instead of profiles
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