-- Fresh installer bootstraps previously folded unquoted timeInForce to
-- timeinforce. The fill writer and API contract use the case-sensitive name.
-- Rename in place so existing rows, grants, policies and indexes are retained.
DO $$
DECLARE
  has_lowercase boolean;
  has_camelcase boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.live_fills'::regclass
      AND attname = 'timeinforce' AND NOT attisdropped),
    EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.live_fills'::regclass
      AND attname = 'timeInForce' AND NOT attisdropped)
  INTO has_lowercase, has_camelcase;

  IF has_lowercase AND NOT has_camelcase THEN
    ALTER TABLE public.live_fills RENAME COLUMN timeinforce TO "timeInForce";
  ELSIF has_lowercase AND has_camelcase THEN
    RAISE EXCEPTION 'live_fills has both timeinforce and timeInForce; reconcile the columns explicitly';
  ELSIF NOT has_camelcase THEN
    RAISE EXCEPTION 'live_fills timeInForce column is missing; inspect the schema before upgrading';
  END IF;
END;
$$;

-- Refresh PostgREST column metadata after the transaction commits.
NOTIFY pgrst, 'reload schema';
