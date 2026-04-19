-- Drop legacy event_id idempotency in favor of fill_id-based deduplication
ALTER TABLE public.live_fills
  DROP CONSTRAINT IF EXISTS uq_live_fills_event_id;

-- Defensive cleanup for environments where the unique was created with the default name
ALTER TABLE public.live_fills
  DROP CONSTRAINT IF EXISTS live_fills_user_id_broker_event_id_key;

DROP INDEX IF EXISTS public.live_fills_user_id_broker_event_id_key;

ALTER TABLE public.live_fills
  DROP COLUMN IF EXISTS event_id;
