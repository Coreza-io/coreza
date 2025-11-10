-- Add timezone column to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'UTC';

COMMENT ON COLUMN public.users.timezone IS 'User preferred timezone for displaying dates (e.g., UTC, America/New_York, Asia/Kolkata)';