-- Additive reporting metadata. Deploy before the backend OHLC writer.
-- Existing daily-close-only rows intentionally remain NULL; no synthetic backfill.
BEGIN;

ALTER TABLE public.portfolio
  ADD COLUMN equity_open numeric,
  ADD COLUMN equity_high numeric,
  ADD COLUMN equity_low numeric,
  ADD COLUMN equity_close numeric,
  ADD COLUMN equity_sample_count integer;

ALTER TABLE public.portfolio ADD CONSTRAINT portfolio_equity_ohlc_valid CHECK (
  num_nonnulls(equity_open,equity_high,equity_low,equity_close,equity_sample_count)=0
  OR (
    num_nonnulls(equity_open,equity_high,equity_low,equity_close,equity_sample_count)=5
    AND equity_sample_count > 0
    AND total_value IS NOT NULL AND equity_close=total_value
    AND equity_high >= greatest(equity_open,equity_close)
    AND equity_low <= least(equity_open,equity_close)
    AND equity_high >= equity_low
    AND equity_low > '-Infinity'::numeric AND equity_high < 'Infinity'::numeric
  )
);

COMMENT ON COLUMN public.portfolio.equity_open IS 'First observed portfolio equity in the UTC reporting day; not a security price.';
COMMENT ON COLUMN public.portfolio.equity_sample_count IS 'Distinct observed valuation timestamps in the UTC day. One observation produces a sparse doji.';
-- Existing scope-validation triggers, SELECT-only authenticated grants and RLS
-- are deliberately unchanged. OHLC is written by the existing reporting writer.

COMMIT;
