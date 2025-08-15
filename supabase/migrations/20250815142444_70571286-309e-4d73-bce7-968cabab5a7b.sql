-- Add envelope encryption columns to user_credentials table
ALTER TABLE public.user_credentials 
ADD COLUMN enc_payload bytea,
ADD COLUMN iv bytea,
ADD COLUMN auth_tag bytea,
ADD COLUMN dek_wrapped bytea,
ADD COLUMN is_encrypted boolean DEFAULT false,
ADD COLUMN enc_version smallint DEFAULT 1,
ADD COLUMN key_ref text DEFAULT 'env:v1',
ADD COLUMN key_algo text DEFAULT 'AES-256-GCM';

-- Add index for performance on encrypted credentials
CREATE INDEX idx_user_credentials_encrypted ON public.user_credentials (user_id, is_encrypted);
CREATE INDEX idx_user_credentials_key_ref ON public.user_credentials (key_ref);