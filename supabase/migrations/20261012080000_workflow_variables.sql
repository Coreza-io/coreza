-- Read-only per-user configuration, separate from runtime Store/$state.
ALTER TABLE public.workflow_runs ADD COLUMN IF NOT EXISTS variable_revision text CHECK (variable_revision ~ '^[0-9]+$');
CREATE TABLE IF NOT EXISTS public.workflow_variable_revisions (
  owner_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
CREATE TABLE IF NOT EXISTS public.workflow_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$' AND key NOT IN ('__proto__', 'constructor', 'prototype')),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) IN ('string','number','boolean','null') AND octet_length(value::text) <= 4096),
  value_type text NOT NULL CHECK (value_type = jsonb_typeof(value)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  UNIQUE (owner_user_id, key)
);
ALTER TABLE public.workflow_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_variable_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS variable_owner_read ON public.workflow_variables;
CREATE POLICY variable_owner_read ON public.workflow_variables FOR SELECT TO authenticated USING (owner_user_id = auth.uid());
DROP POLICY IF EXISTS variable_revision_owner_read ON public.workflow_variable_revisions;
CREATE POLICY variable_revision_owner_read ON public.workflow_variable_revisions FOR SELECT TO authenticated USING (owner_user_id = auth.uid());
REVOKE ALL ON public.workflow_variables, public.workflow_variable_revisions FROM anon, authenticated;
GRANT SELECT ON public.workflow_variables, public.workflow_variable_revisions TO authenticated;
-- Service-role writes also go through the revisioned RPC.
REVOKE INSERT, UPDATE, DELETE ON public.workflow_variables, public.workflow_variable_revisions FROM service_role;

CREATE OR REPLACE FUNCTION public.workflow_variables_snapshot(p_owner uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('schemaVersion', 1, 'owner', p_owner,
    'revision', coalesce((SELECT revision FROM workflow_variable_revisions WHERE owner_user_id = p_owner), 0)::text,
    'loadedAt', floor(extract(epoch FROM statement_timestamp()) * 1000),
    'entries', coalesce((SELECT jsonb_agg(jsonb_build_object('key', key, 'value', value, 'value_type', value_type, 'updated_at', updated_at) ORDER BY key)
      FROM workflow_variables WHERE owner_user_id = p_owner), '[]'::jsonb))
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
    DELETE FROM workflow_variables WHERE owner_user_id = p_owner AND key = p_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'variable-not-found' USING ERRCODE = 'P0002'; END IF;
  ELSE
    IF p_value IS NULL OR jsonb_typeof(p_value) NOT IN ('string','number','boolean','null') OR octet_length(p_value::text) > 4096 THEN RAISE EXCEPTION 'invalid-variable-value'; END IF;
    IF jsonb_typeof(p_value) = 'number' AND abs(p_value::text::numeric) > 1.7976931348623157e308 THEN RAISE EXCEPTION 'invalid-variable-number'; END IF;
    IF p_operation = 'create' THEN
      IF (SELECT count(*) FROM workflow_variables WHERE owner_user_id = p_owner) >= 128 THEN RAISE EXCEPTION 'variable-count-limit'; END IF;
      INSERT INTO workflow_variables(owner_user_id,key,value,value_type,updated_by) VALUES(p_owner,p_key,p_value,jsonb_typeof(p_value),p_owner);
    ELSE
      UPDATE workflow_variables SET value=p_value, value_type=jsonb_typeof(p_value), updated_at=now(), updated_by=p_owner WHERE owner_user_id=p_owner AND key=p_key;
      IF NOT FOUND THEN RAISE EXCEPTION 'variable-not-found' USING ERRCODE = 'P0002'; END IF;
    END IF;
    IF (SELECT octet_length(coalesce(jsonb_agg(jsonb_build_object('key',key,'value',value,'value_type',value_type,'updated_at',updated_at) ORDER BY key), '[]')::text) FROM workflow_variables WHERE owner_user_id=p_owner) > 65536 THEN RAISE EXCEPTION 'variable-snapshot-limit'; END IF;
  END IF;
  UPDATE workflow_variable_revisions SET revision = revision + 1 WHERE owner_user_id=p_owner RETURNING revision INTO new_revision;
  RETURN jsonb_build_object('revision',new_revision::text);
END; $$;
REVOKE ALL ON FUNCTION public.workflow_variables_snapshot(uuid), public.workflow_variables_revision(uuid), public.mutate_workflow_variable(uuid,text,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workflow_variables_snapshot(uuid), public.workflow_variables_revision(uuid), public.mutate_workflow_variable(uuid,text,text,text,jsonb) TO authenticated, service_role;
