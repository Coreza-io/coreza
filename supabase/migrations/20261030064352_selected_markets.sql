-- Display preference only; NULL preserves the existing US-oriented default,
-- while an empty array intentionally displays no markets.
BEGIN;
ALTER TABLE public.users ADD COLUMN selected_markets text[];
ALTER TABLE public.users ADD CONSTRAINT users_selected_markets_allowed CHECK (
  selected_markets IS NULL OR (
    selected_markets <@ ARRAY['nyse', 'nasdaq', 'nse', 'bse', 'crypto']::text[]
    AND array_position(selected_markets, NULL) IS NULL
    AND (cardinality(selected_markets) = 0 OR array_ndims(selected_markets) = 1)
  )
);
COMMENT ON COLUMN public.users.selected_markets IS
  'Dashboard market display IDs. NULL defaults to NYSE/NASDAQ; empty array means none. No trading subscription effects.';
COMMIT;
