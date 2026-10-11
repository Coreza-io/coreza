-- The dialect lives inside node values, carried by every document/run snapshot.
-- An old/alternate writer must not strip it from a retained node.
CREATE OR REPLACE FUNCTION public.guard_expression_workflow_writer() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.nodes, '[]'::jsonb)) n
    WHERE n->'values' ? '__expressionFormatVersion'
      AND n->'values'->'__expressionFormatVersion' IS DISTINCT FROM '1'::jsonb
  ) THEN
    RAISE EXCEPTION 'unsupported-expression-format-version';
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(OLD.nodes, '[]'::jsonb)) previous
    JOIN jsonb_array_elements(COALESCE(NEW.nodes, '[]'::jsonb)) candidate
      ON previous->>'id' = candidate->>'id'
    WHERE previous->'values'->'__expressionFormatVersion' = '1'::jsonb
      AND candidate->'values'->'__expressionFormatVersion' IS DISTINCT FROM '1'::jsonb
  ) THEN
    RAISE EXCEPTION 'expression-writer-upgrade-required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_expression_workflow_writer BEFORE INSERT OR UPDATE ON public.workflows
FOR EACH ROW EXECUTE FUNCTION public.guard_expression_workflow_writer();

CREATE OR REPLACE FUNCTION public.expression_workflow_write_ready() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_expression_workflow_writer'
    AND tgrelid = 'public.workflows'::regclass AND tgenabled = 'O')
    AND NOT has_table_privilege('authenticated', 'public.workflows', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.workflows', 'INSERT');
$$;
REVOKE ALL ON FUNCTION public.expression_workflow_write_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expression_workflow_write_ready() TO service_role;
