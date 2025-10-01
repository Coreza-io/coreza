-- Add unique constraint for user_credentials upsert operations
-- This allows users to have multiple credentials per service with unique names

ALTER TABLE public.user_credentials 
ADD CONSTRAINT user_credentials_user_service_name_key 
UNIQUE (user_id, service_type, name);