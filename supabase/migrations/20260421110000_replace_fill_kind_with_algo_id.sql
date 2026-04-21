ALTER TABLE public.live_fills
  DROP COLUMN IF EXISTS fill_kind;

ALTER TABLE public.live_fills
  ADD COLUMN IF NOT EXISTS algo_id text;
