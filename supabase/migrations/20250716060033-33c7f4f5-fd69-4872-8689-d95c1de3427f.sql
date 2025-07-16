-- Add unique constraint for user credentials to prevent duplicates
ALTER TABLE public.user_credentials 
ADD CONSTRAINT user_credentials_unique_service 
UNIQUE (user_id, service_type, name);