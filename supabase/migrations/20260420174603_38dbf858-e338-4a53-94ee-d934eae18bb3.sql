ALTER TABLE public.live_fills
  ADD COLUMN IF NOT EXISTS fill_kind text NOT NULL DEFAULT 'fill';

CREATE INDEX IF NOT EXISTS idx_live_fills_user_kind_time
  ON public.live_fills (user_id, fill_kind, event_time DESC);