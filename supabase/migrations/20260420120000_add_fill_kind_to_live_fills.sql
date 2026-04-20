ALTER TABLE public.live_fills
  ADD COLUMN IF NOT EXISTS fill_kind text NOT NULL DEFAULT 'fill';
