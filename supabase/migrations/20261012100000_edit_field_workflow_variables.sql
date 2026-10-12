-- Extend the deployed variable tables; do not create a parallel registry.
-- Existing rows remain user-global (workflow_id NULL) and keep their IDs/metadata.
ALTER TABLE public.workflow_variables ADD COLUMN IF NOT EXISTS workflow_id uuid REFERENCES public.workflows(id) ON DELETE CASCADE;
ALTER TABLE public.workflow_variables DROP CONSTRAINT IF EXISTS workflow_variables_owner_user_id_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS workflow_variables_global_key ON public.workflow_variables(owner_user_id,key) WHERE workflow_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS workflow_variables_workflow_key ON public.workflow_variables(owner_user_id,workflow_id,key) WHERE workflow_id IS NOT NULL;
-- Retain the existing owner revision/lock and store scoped replay receipts in that row.
ALTER TABLE public.workflow_variable_revisions ADD COLUMN IF NOT EXISTS commit_receipts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(commit_receipts)='object');
DROP POLICY IF EXISTS variable_owner_read ON public.workflow_variables;
CREATE POLICY variable_owner_read ON public.workflow_variables FOR SELECT TO authenticated
  USING (owner_user_id=auth.uid() AND (workflow_id IS NULL OR EXISTS (SELECT 1 FROM public.workflows WHERE id=workflow_id AND user_id=auth.uid())));

CREATE OR REPLACE FUNCTION public.workflow_variables_snapshot(p_owner uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('schemaVersion', 1, 'owner', p_owner,
    'revision', coalesce((SELECT revision FROM workflow_variable_revisions WHERE owner_user_id = p_owner), 0)::text,
    'loadedAt', floor(extract(epoch FROM statement_timestamp()) * 1000),
    'entries', coalesce((SELECT jsonb_agg(jsonb_build_object('key', key, 'value', value, 'value_type', value_type, 'updated_at', updated_at) ORDER BY key)
      FROM workflow_variables WHERE owner_user_id = p_owner AND workflow_id IS NULL), '[]'::jsonb))
  WHERE auth.role() = 'service_role' OR auth.uid() = p_owner;
$$;
CREATE OR REPLACE FUNCTION public.workflow_variables_revision(p_owner uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT revision FROM workflow_variable_revisions WHERE owner_user_id = p_owner), 0)::text
  WHERE auth.role() = 'service_role' OR auth.uid() = p_owner;
$$;
CREATE OR REPLACE FUNCTION public.mutate_workflow_variable(p_owner uuid, p_expected_revision text, p_operation text, p_key text, p_value jsonb DEFAULT 'null') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE current_revision bigint; new_revision bigint;
BEGIN
  IF p_owner IS NULL OR (auth.role() = 'service_role' OR auth.uid() = p_owner) IS NOT TRUE THEN RAISE EXCEPTION 'variable-owner-denied' USING ERRCODE = '42501'; END IF;
  IF p_key IS NULL OR p_key !~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$' OR p_key IN ('__proto__','constructor','prototype') THEN RAISE EXCEPTION 'invalid-variable-key'; END IF;
  IF p_operation NOT IN ('create','update','delete') OR p_operation IS NULL THEN RAISE EXCEPTION 'invalid-variable-operation'; END IF;
  INSERT INTO workflow_variable_revisions(owner_user_id) VALUES (p_owner) ON CONFLICT DO NOTHING;
  SELECT revision INTO current_revision FROM workflow_variable_revisions WHERE owner_user_id = p_owner FOR UPDATE;
  IF p_expected_revision IS NULL OR p_expected_revision <> current_revision::text THEN RAISE EXCEPTION 'variable-revision-conflict' USING ERRCODE = '40001'; END IF;
  IF p_operation = 'delete' THEN
    DELETE FROM workflow_variables WHERE owner_user_id = p_owner AND key = p_key AND workflow_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'variable-not-found' USING ERRCODE = 'P0002'; END IF;
  ELSE
    IF p_value IS NULL OR jsonb_typeof(p_value) NOT IN ('string','number','boolean','null') OR octet_length(p_value::text) > 4096 THEN RAISE EXCEPTION 'invalid-variable-value'; END IF;
    IF jsonb_typeof(p_value) = 'number' AND abs(p_value::text::numeric) > 1.7976931348623157e308 THEN RAISE EXCEPTION 'invalid-variable-number'; END IF;
    IF p_operation = 'create' THEN
      IF (SELECT count(*) FROM workflow_variables WHERE owner_user_id = p_owner AND workflow_id IS NULL) >= 128 THEN RAISE EXCEPTION 'variable-count-limit'; END IF;
      INSERT INTO workflow_variables(owner_user_id,key,value,value_type,updated_by) VALUES(p_owner,p_key,p_value,jsonb_typeof(p_value),p_owner);
    ELSE
      UPDATE workflow_variables SET value=p_value, value_type=jsonb_typeof(p_value), updated_at=now(), updated_by=p_owner WHERE owner_user_id=p_owner AND key=p_key AND workflow_id IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'variable-not-found' USING ERRCODE = 'P0002'; END IF;
    END IF;
    IF (SELECT octet_length(coalesce(jsonb_agg(jsonb_build_object('key',key,'value',value,'value_type',value_type,'updated_at',updated_at) ORDER BY key), '[]')::text) FROM workflow_variables WHERE owner_user_id=p_owner AND workflow_id IS NULL) > 65536 THEN RAISE EXCEPTION 'variable-snapshot-limit'; END IF;
  END IF;
  UPDATE workflow_variable_revisions SET revision = revision + 1 WHERE owner_user_id=p_owner RETURNING revision INTO new_revision;
  RETURN jsonb_build_object('revision',new_revision::text);
END; $$;
REVOKE ALL ON FUNCTION public.workflow_variables_snapshot(uuid), public.workflow_variables_revision(uuid), public.mutate_workflow_variable(uuid,text,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workflow_variables_snapshot(uuid), public.workflow_variables_revision(uuid), public.mutate_workflow_variable(uuid,text,text,text,jsonb) TO authenticated, service_role;

-- Scoped overloads reuse the existing RPC names and owner revision.
CREATE OR REPLACE FUNCTION public.workflow_variables_revision(p_owner uuid,p_workflow uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF (auth.role()='service_role' OR auth.uid()=p_owner) IS NOT TRUE OR NOT EXISTS (SELECT 1 FROM workflows WHERE id=p_workflow AND user_id=p_owner) THEN
    RAISE EXCEPTION 'variable-workflow-denied' USING ERRCODE='42501';
  END IF;
  RETURN coalesce((SELECT revision FROM workflow_variable_revisions WHERE owner_user_id=p_owner),0)::text;
END; $$;
CREATE OR REPLACE FUNCTION public.workflow_variables_snapshot(p_owner uuid,p_workflow uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_revision text;
BEGIN
  current_revision:=workflow_variables_revision(p_owner,p_workflow);
  RETURN jsonb_build_object('schemaVersion',1,'owner',p_owner,'workflowId',p_workflow,'revision',current_revision,
    'loadedAt',floor(extract(epoch FROM statement_timestamp())*1000),
    'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('key',key,'value',value,'value_type',jsonb_typeof(value),'updated_at',updated_at) ORDER BY key)
      FROM workflow_variables WHERE owner_user_id=p_owner AND workflow_id=p_workflow),'[]'::jsonb));
END; $$;
CREATE OR REPLACE FUNCTION public.commit_workflow_variables(p_owner uuid,p_workflow uuid,p_expected_revision text,p_token text,p_changes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_revision bigint; item jsonb; receipt jsonb; receipt_key text:=p_workflow::text || ':' || p_token; result jsonb;
BEGIN
  PERFORM workflow_variables_revision(p_owner,p_workflow);
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
  INSERT INTO workflow_variable_revisions(owner_user_id) VALUES(p_owner) ON CONFLICT DO NOTHING;
  SELECT revision,commit_receipts->receipt_key INTO current_revision,receipt FROM workflow_variable_revisions WHERE owner_user_id=p_owner FOR UPDATE;
  IF receipt IS NOT NULL THEN
    IF receipt->'changes'<>p_changes OR coalesce(p_expected_revision::numeric, -1)>(receipt->'snapshot'->>'revision')::numeric THEN
      RAISE EXCEPTION 'variable-replay-conflict' USING ERRCODE='40001';
    END IF;
    RETURN receipt->'snapshot';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision<>current_revision::text THEN RAISE EXCEPTION 'variable-revision-conflict' USING ERRCODE='40001'; END IF;
  INSERT INTO workflow_variables(owner_user_id,workflow_id,key,value,value_type,updated_by)
    SELECT p_owner,p_workflow,entry->>'key',entry->'value',jsonb_typeof(entry->'value'),p_owner FROM jsonb_array_elements(p_changes) entry
    ON CONFLICT(owner_user_id,workflow_id,key) WHERE workflow_id IS NOT NULL
    DO UPDATE SET value=EXCLUDED.value,value_type=EXCLUDED.value_type,updated_at=now(),updated_by=p_owner;
  IF (SELECT count(*) FROM workflow_variables WHERE owner_user_id=p_owner AND workflow_id=p_workflow)>128 THEN RAISE EXCEPTION 'variable-count-limit'; END IF;
  UPDATE workflow_variable_revisions SET revision=revision+1 WHERE owner_user_id=p_owner;
  SELECT jsonb_build_object('schemaVersion',1,'owner',p_owner,'workflowId',p_workflow,'revision',(current_revision+1)::text,
    'loadedAt',floor(extract(epoch FROM statement_timestamp())*1000),
    'entries',coalesce(jsonb_agg(jsonb_build_object('key',key,'value',value,'value_type',jsonb_typeof(value),'updated_at',updated_at) ORDER BY key),'[]'::jsonb))
    INTO result FROM workflow_variables WHERE owner_user_id=p_owner AND workflow_id=p_workflow;
  IF octet_length((result->'entries')::text)>65536 THEN RAISE EXCEPTION 'variable-snapshot-limit'; END IF;
  UPDATE workflow_variable_revisions SET commit_receipts=commit_receipts || jsonb_build_object(receipt_key,jsonb_build_object('changes',p_changes,'snapshot',result)) WHERE owner_user_id=p_owner;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.workflow_variables_revision(uuid,uuid),public.workflow_variables_snapshot(uuid,uuid),public.commit_workflow_variables(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workflow_variables_revision(uuid,uuid),public.workflow_variables_snapshot(uuid,uuid),public.commit_workflow_variables(uuid,uuid,text,text,jsonb) TO authenticated,service_role;
