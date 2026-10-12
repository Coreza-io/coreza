-- Workflow namespace is separate from the preserved, read-only user-global registry.
CREATE TABLE IF NOT EXISTS public.workflow_scoped_variable_revisions (
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  PRIMARY KEY (owner_user_id, workflow_id)
);
CREATE TABLE IF NOT EXISTS public.workflow_scoped_variables (
  owner_user_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  key text NOT NULL CHECK (key ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$' AND key NOT IN ('__proto__','constructor','prototype')),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) IN ('string','number','boolean','null') AND octet_length(value::text) <= 4096),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, workflow_id, key),
  FOREIGN KEY (owner_user_id,workflow_id) REFERENCES public.workflow_scoped_variable_revisions ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.workflow_variable_commits (
  owner_user_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  token text NOT NULL CHECK (length(token) BETWEEN 1 AND 256),
  changes jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  PRIMARY KEY (owner_user_id,workflow_id,token),
  FOREIGN KEY (owner_user_id,workflow_id) REFERENCES public.workflow_scoped_variable_revisions ON DELETE CASCADE
);
ALTER TABLE public.workflow_scoped_variable_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_scoped_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_variable_commits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scoped_variable_read ON public.workflow_scoped_variables;
CREATE POLICY scoped_variable_read ON public.workflow_scoped_variables FOR SELECT TO authenticated
  USING (owner_user_id=auth.uid() AND EXISTS (SELECT 1 FROM public.workflows WHERE id=workflow_id AND user_id=auth.uid()));
DROP POLICY IF EXISTS scoped_revision_read ON public.workflow_scoped_variable_revisions;
CREATE POLICY scoped_revision_read ON public.workflow_scoped_variable_revisions FOR SELECT TO authenticated
  USING (owner_user_id=auth.uid() AND EXISTS (SELECT 1 FROM public.workflows WHERE id=workflow_id AND user_id=auth.uid()));
REVOKE ALL ON public.workflow_scoped_variables, public.workflow_scoped_variable_revisions, public.workflow_variable_commits FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.workflow_scoped_variables, public.workflow_scoped_variable_revisions, public.workflow_variable_commits FROM service_role;
GRANT SELECT ON public.workflow_scoped_variables, public.workflow_scoped_variable_revisions TO authenticated;

CREATE OR REPLACE FUNCTION public.scoped_workflow_variables_revision(p_owner uuid,p_workflow uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF (auth.role()='service_role' OR auth.uid()=p_owner) IS NOT TRUE OR NOT EXISTS (SELECT 1 FROM workflows WHERE id=p_workflow AND user_id=p_owner) THEN
    RAISE EXCEPTION 'variable-workflow-denied' USING ERRCODE='42501';
  END IF;
  RETURN coalesce((SELECT revision FROM workflow_scoped_variable_revisions WHERE owner_user_id=p_owner AND workflow_id=p_workflow),0)::text;
END; $$;
CREATE OR REPLACE FUNCTION public.scoped_workflow_variables_snapshot(p_owner uuid,p_workflow uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_revision text;
BEGIN
  current_revision:=scoped_workflow_variables_revision(p_owner,p_workflow);
  RETURN jsonb_build_object('schemaVersion',1,'owner',p_owner,'workflowId',p_workflow,'revision',current_revision,
    'loadedAt',floor(extract(epoch FROM statement_timestamp())*1000),
    'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('key',key,'value',value,'value_type',jsonb_typeof(value),'updated_at',updated_at) ORDER BY key)
      FROM workflow_scoped_variables WHERE owner_user_id=p_owner AND workflow_id=p_workflow),'[]'::jsonb));
END; $$;
CREATE OR REPLACE FUNCTION public.commit_workflow_variables(p_owner uuid,p_workflow uuid,p_expected_revision text,p_token text,p_changes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_revision bigint; item jsonb; receipt workflow_variable_commits%ROWTYPE; result jsonb;
BEGIN
  PERFORM scoped_workflow_variables_revision(p_owner,p_workflow);
  IF p_token IS NULL OR length(p_token) NOT BETWEEN 1 AND 256 OR p_changes IS NULL OR jsonb_typeof(p_changes)<>'array' THEN RAISE EXCEPTION 'invalid-variable-batch'; END IF;
  IF jsonb_array_length(p_changes) NOT BETWEEN 1 AND 128 OR octet_length(p_changes::text)>65536 THEN RAISE EXCEPTION 'invalid-variable-batch'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes) entry GROUP BY entry->>'key' HAVING count(*)>1) THEN RAISE EXCEPTION 'duplicate-variable-name'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
    IF jsonb_typeof(item)<>'object' OR NOT (item ? 'key' AND item ? 'value') OR jsonb_typeof(item->'key')<>'string'
      OR item->>'key' !~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$' OR item->>'key' IN ('__proto__','constructor','prototype')
      OR jsonb_typeof(item->'value') NOT IN ('string','number','boolean','null') OR octet_length((item->'value')::text)>4096
      OR (SELECT count(*) FROM jsonb_object_keys(item))<>2 THEN RAISE EXCEPTION 'invalid-variable-value'; END IF;
    IF jsonb_typeof(item->'value')='number' AND abs((item->>'value')::numeric)>1.7976931348623157e308 THEN RAISE EXCEPTION 'invalid-variable-number'; END IF;
  END LOOP;
  INSERT INTO workflow_scoped_variable_revisions(owner_user_id,workflow_id) VALUES(p_owner,p_workflow) ON CONFLICT DO NOTHING;
  SELECT revision INTO current_revision FROM workflow_scoped_variable_revisions WHERE owner_user_id=p_owner AND workflow_id=p_workflow FOR UPDATE;
  SELECT * INTO receipt FROM workflow_variable_commits WHERE owner_user_id=p_owner AND workflow_id=p_workflow AND token=p_token;
  IF FOUND THEN
    IF receipt.changes<>p_changes OR coalesce(p_expected_revision::numeric, -1)>(receipt.snapshot->>'revision')::numeric THEN
      RAISE EXCEPTION 'variable-replay-conflict' USING ERRCODE='40001';
    END IF;
    RETURN receipt.snapshot;
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision<>current_revision::text THEN RAISE EXCEPTION 'variable-revision-conflict' USING ERRCODE='40001'; END IF;
  INSERT INTO workflow_scoped_variables(owner_user_id,workflow_id,key,value)
    SELECT p_owner,p_workflow,entry->>'key',entry->'value' FROM jsonb_array_elements(p_changes) entry
    ON CONFLICT(owner_user_id,workflow_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now();
  IF (SELECT count(*) FROM workflow_scoped_variables WHERE owner_user_id=p_owner AND workflow_id=p_workflow)>128 THEN RAISE EXCEPTION 'variable-count-limit'; END IF;
  UPDATE workflow_scoped_variable_revisions SET revision=revision+1 WHERE owner_user_id=p_owner AND workflow_id=p_workflow;
  SELECT jsonb_build_object('schemaVersion',1,'owner',p_owner,'workflowId',p_workflow,'revision',(current_revision+1)::text,
    'loadedAt',floor(extract(epoch FROM statement_timestamp())*1000),
    'entries',coalesce(jsonb_agg(jsonb_build_object('key',key,'value',value,'value_type',jsonb_typeof(value),'updated_at',updated_at) ORDER BY key),'[]'::jsonb))
    INTO result FROM workflow_scoped_variables WHERE owner_user_id=p_owner AND workflow_id=p_workflow;
  IF octet_length((result->'entries')::text)>65536 THEN RAISE EXCEPTION 'variable-snapshot-limit'; END IF;
  INSERT INTO workflow_variable_commits VALUES(p_owner,p_workflow,p_token,p_changes,result);
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.scoped_workflow_variables_revision(uuid,uuid),public.scoped_workflow_variables_snapshot(uuid,uuid),public.commit_workflow_variables(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.scoped_workflow_variables_revision(uuid,uuid),public.scoped_workflow_variables_snapshot(uuid,uuid),public.commit_workflow_variables(uuid,uuid,text,text,jsonb) TO authenticated,service_role;
