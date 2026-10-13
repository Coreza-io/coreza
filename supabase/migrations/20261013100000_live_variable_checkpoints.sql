-- Default-off, replaceable-state checkpoints. Eligibility/recovery are operator policy,
-- never inferred from user-authored node/variable names. No per-invocation receipts.
CREATE TABLE IF NOT EXISTS public.workflow_live_variable_state (
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  eligible boolean NOT NULL DEFAULT false,
  recovery_approved boolean NOT NULL DEFAULT false,
  phase text NOT NULL DEFAULT 'idle' CHECK (phase IN ('idle','recovering','prepared','active')),
  writer uuid,
  fence bigint NOT NULL DEFAULT 0 CHECK (fence >= 0),
  lease_until timestamptz,
  epoch uuid,
  producer_fence bigint NOT NULL DEFAULT 0,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  payload text CHECK (octet_length(payload) <= 262144),
  payload_hash text,
  checkpoint_after timestamptz NOT NULL DEFAULT '-infinity',
  PRIMARY KEY (owner_user_id, workflow_id)
);
ALTER TABLE public.workflow_live_variable_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workflow_live_variable_state FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX IF NOT EXISTS live_variable_recovery_inventory ON public.workflow_live_variable_state(workflow_id,owner_user_id) WHERE phase <> 'idle';

CREATE OR REPLACE FUNCTION public.validate_live_variable_checkpoint(p_payload text,p_hash text,p_owner uuid,p_workflow uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e jsonb; item jsonb; v jsonb;
BEGIN
  IF p_payload IS NULL OR octet_length(p_payload)>262144 OR p_hash IS NULL
    OR p_hash !~ '^[a-f0-9]{64}$' OR encode(sha256(convert_to(p_payload,'UTF8')),'hex')<>p_hash THEN RAISE EXCEPTION 'live-variable-hash-size'; END IF;
  e:=p_payload::jsonb;
  IF (e->>'schemaVersion'='1' AND e->'snapshot'->>'schemaVersion'='1' AND e->'snapshot'->>'owner'=p_owner::text
    AND e->'snapshot'->>'workflowId'=p_workflow::text AND e->>'fence' ~ '^(0|[1-9][0-9]*)$'
    AND jsonb_typeof(e->'epoch')='string' AND e->>'epoch' ~ '^[0-9a-f-]{36}$'
    AND jsonb_typeof(e->'source'->'event')='string' AND e->'snapshot'->>'loadedAt' ~ '^[0-9]+(\.[0-9]+)?$'
    AND e->>'generation' ~ '^(0|[1-9][0-9]*)$' AND e->'snapshot'->>'revision' ~ '^[0-9]+$'
    AND e->>'capturedAt' ~ '^[0-9]+(\.[0-9]+)?$' AND length(e->'source'->>'event')<=256
    AND e->'source'->>'outcome' IN ('success','failed','cancelled')) IS NOT TRUE THEN RAISE EXCEPTION 'live-variable-envelope'; END IF;
  PERFORM (e->>'epoch')::uuid, (e->>'fence')::bigint, (e->>'generation')::bigint;
  IF e->'parent'<>'null'::jsonb THEN
    IF (jsonb_typeof(e->'parent'->'epoch')='string' AND e->'parent'->>'epoch' ~ '^[0-9a-f-]{36}$' AND e->'parent'->>'hash' ~ '^[a-f0-9]{64}$' AND e->'parent'->>'fence' ~ '^(0|[1-9][0-9]*)$'
      AND e->'parent'->>'generation' ~ '^(0|[1-9][0-9]*)$') IS NOT TRUE THEN RAISE EXCEPTION 'live-variable-parent'; END IF;
    PERFORM (e->'parent'->>'epoch')::uuid, (e->'parent'->>'fence')::bigint, (e->'parent'->>'generation')::bigint;
  ELSIF NOT (e ? 'parent') THEN RAISE EXCEPTION 'live-variable-parent'; END IF;
  v:=e->'snapshot'->'entries';
  IF v IS NULL OR jsonb_typeof(v)<>'array' THEN RAISE EXCEPTION 'live-variable-entries'; END IF;
  IF jsonb_array_length(v)>128 OR octet_length(v::text)>65536 THEN RAISE EXCEPTION 'live-variable-snapshot-limit'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) x GROUP BY x->>'key' HAVING count(*)>1) THEN RAISE EXCEPTION 'live-variable-duplicate'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(v) LOOP
    IF (jsonb_typeof(item)='object' AND jsonb_typeof(item->'key')='string' AND item->>'key' ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'
      AND item->>'key' NOT IN ('__proto__','constructor','prototype') AND item->>'value_type'=jsonb_typeof(item->'value')
      AND jsonb_typeof(item->'value') IN ('string','number','boolean','null') AND octet_length((item->'value')::text)<=4096
      AND jsonb_typeof(item->'updated_at')='string' AND length(item->>'updated_at')<=64) IS NOT TRUE THEN RAISE EXCEPTION 'live-variable-entry'; END IF;
    PERFORM (item->>'updated_at')::timestamptz;
    IF jsonb_typeof(item->'value')='number' AND abs((item->>'value')::numeric)>1.7976931348623157e308 THEN RAISE EXCEPTION 'live-variable-number'; END IF;
  END LOOP;
  RETURN e;
END; $$;
REVOKE ALL ON FUNCTION public.validate_live_variable_checkpoint(text,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.workflow_live_variables(p_operation text,p_owner uuid,p_workflow uuid,p_args jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s workflow_live_variable_state%ROWTYPE; e jsonb; parent jsonb; r bigint; fresh boolean; snap jsonb;
BEGIN
  PERFORM set_config('lock_timeout','500ms',true);
  -- This infrastructure RPC is server-only; even service calls must bind the workflow owner.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'live-variable-server-only' USING ERRCODE='42501'; END IF;
  IF p_operation='inventory' THEN
    RETURN jsonb_build_object('scopes',coalesce((SELECT jsonb_agg(x) FROM (
      SELECT owner_user_id AS owner,workflow_id AS workflow FROM workflow_live_variable_state
      WHERE phase<>'idle' AND (p_args->>'after' IS NULL OR (workflow_id,owner_user_id)>((p_args->'after'->>'workflow')::uuid,(p_args->'after'->>'owner')::uuid))
      ORDER BY workflow_id,owner_user_id LIMIT 32) x),'[]'::jsonb));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workflows WHERE id=p_workflow AND user_id=p_owner) THEN RAISE EXCEPTION 'live-variable-workflow-denied' USING ERRCODE='42501'; END IF;
  IF p_operation='eligible' THEN
    SELECT * INTO s FROM workflow_live_variable_state WHERE owner_user_id=p_owner AND workflow_id=p_workflow;
    RETURN jsonb_build_object('eligible',coalesce(s.eligible,false),'owned',FOUND AND s.phase<>'idle');
  END IF;
  IF p_operation='source' THEN
    SELECT * INTO s FROM workflow_live_variable_state WHERE owner_user_id=p_owner AND workflow_id=p_workflow;
    RETURN jsonb_build_object('active',FOUND AND s.phase<>'idle','payload',s.payload,'hash',s.payload_hash);
  END IF;
  IF p_operation='claim' THEN
    IF p_args->>'writer' IS NULL THEN RAISE EXCEPTION 'live-variable-writer-required'; END IF;
    PERFORM pg_advisory_xact_lock(713102026);
  END IF;
  -- The owner revision always precedes the scope lock, including legacy writers/handoff.
  IF p_operation IN ('claim','handoff') THEN
    INSERT INTO workflow_variable_revisions(owner_user_id) VALUES(p_owner) ON CONFLICT DO NOTHING;
    SELECT revision INTO r FROM workflow_variable_revisions WHERE owner_user_id=p_owner FOR UPDATE;
  ELSE
    SELECT coalesce(revision,0) INTO r FROM workflow_variable_revisions WHERE owner_user_id=p_owner;
  END IF;
  SELECT * INTO s FROM workflow_live_variable_state WHERE owner_user_id=p_owner AND workflow_id=p_workflow FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'live-variable-policy-missing'; END IF;
  IF p_operation='claim' THEN
    IF NOT s.eligible THEN RAISE EXCEPTION 'live-variable-ineligible'; END IF;
    IF s.phase<>'idle' AND s.lease_until>clock_timestamp() THEN
      IF s.writer IS DISTINCT FROM (p_args->>'writer')::uuid OR s.phase<>'recovering' THEN RAISE EXCEPTION 'live-variable-owned'; END IF;
    ELSE
      IF s.phase<>'idle' AND NOT s.recovery_approved THEN RAISE EXCEPTION 'live-variable-recovery-approval-required'; END IF;
      IF s.phase='idle' AND (SELECT count(*) FROM workflow_live_variable_state WHERE phase<>'idle')>=128 THEN RAISE EXCEPTION 'live-variable-global-scope-limit'; END IF;
      fresh:=s.phase='idle';
      UPDATE workflow_live_variable_state SET writer=(p_args->>'writer')::uuid,fence=fence+1,
        lease_until=clock_timestamp()+interval '15 seconds',phase='recovering',recovery_approved=false
        WHERE owner_user_id=p_owner AND workflow_id=p_workflow RETURNING * INTO s;
    END IF;
    SELECT jsonb_build_object('schemaVersion',1,'owner',p_owner,'workflowId',p_workflow,'revision',r::text,
      'loadedAt',floor(extract(epoch FROM clock_timestamp())*1000),
      'entries',coalesce(jsonb_agg(jsonb_build_object('key',key,'value',value,'value_type',jsonb_typeof(value),'updated_at',updated_at) ORDER BY key),'[]'::jsonb)) INTO snap
      FROM workflow_variables WHERE owner_user_id=p_owner AND workflow_id=p_workflow;
    RETURN jsonb_build_object('fence',s.fence::text,'lease_ms',greatest(0,floor(extract(epoch FROM (s.lease_until-clock_timestamp()))*1000)),
      'fresh',coalesce(fresh,false),'payload',s.payload,'hash',s.payload_hash,'snapshot',snap,'legacy_revision',r::text);
  END IF;
  IF p_operation='handoff' AND s.phase='idle' AND s.fence::text=p_args->>'fence'
    AND s.epoch::text=p_args->>'epoch' AND s.generation::text=p_args->>'generation' AND s.payload_hash=p_args->>'hash' THEN
    RETURN jsonb_build_object('revision',r::text); -- Lost handoff response: receipt without repeating the transfer.
  END IF;
  IF p_operation IN ('prepare','activate','renew','handoff') THEN
    IF s.writer IS DISTINCT FROM (p_args->>'writer')::uuid OR s.fence::text IS DISTINCT FROM p_args->>'fence' THEN RAISE EXCEPTION 'live-variable-stale-authority'; END IF;
  END IF;
  IF p_operation IN ('prepare','activate','renew') AND s.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'live-variable-lease-expired'; END IF;
  IF p_operation='renew' THEN
    IF NOT s.eligible THEN RAISE EXCEPTION 'live-variable-ineligible'; END IF;
    IF s.phase<>'active' OR s.epoch IS DISTINCT FROM (p_args->>'epoch')::uuid THEN RAISE EXCEPTION 'live-variable-not-active'; END IF;
    UPDATE workflow_live_variable_state SET lease_until=clock_timestamp()+interval '15 seconds' WHERE owner_user_id=p_owner AND workflow_id=p_workflow;
    RETURN jsonb_build_object('lease_ms',15000);
  ELSIF p_operation='prepare' THEN
    e:=validate_live_variable_checkpoint(p_args->>'payload',p_args->>'hash',p_owner,p_workflow);
    IF s.phase='prepared' AND s.payload_hash=p_args->>'hash' THEN RETURN '{}'::jsonb; END IF;
    IF s.phase<>'recovering' OR e->>'fence'<>s.fence::text OR e->>'generation'<>'0' THEN RAISE EXCEPTION 'live-variable-transition'; END IF;
    IF s.payload IS NOT NULL THEN
      parent:=validate_live_variable_checkpoint(p_args->>'parent_payload',p_args->>'parent_hash',p_owner,p_workflow);
      IF (parent->>'epoch'=s.epoch::text AND parent->>'fence'=s.producer_fence::text AND (parent->>'generation')::bigint>=s.generation
        AND e->'parent'=jsonb_build_object('epoch',parent->>'epoch','fence',parent->>'fence','generation',parent->>'generation','hash',p_args->>'parent_hash')) IS NOT TRUE
        OR ((parent->>'generation')::bigint=s.generation AND p_args->>'parent_hash'<>s.payload_hash) THEN RAISE EXCEPTION 'live-variable-parent-conflict'; END IF;
    ELSIF e->'parent'<>'null'::jsonb THEN RAISE EXCEPTION 'live-variable-unexpected-parent'; END IF;
    UPDATE workflow_live_variable_state SET phase='prepared',epoch=(e->>'epoch')::uuid,producer_fence=s.fence,generation=0,
      payload=p_args->>'payload',payload_hash=p_args->>'hash',checkpoint_after=clock_timestamp()+interval '2 seconds'
      WHERE owner_user_id=p_owner AND workflow_id=p_workflow;
    RETURN '{}'::jsonb;
  ELSIF p_operation='activate' THEN
    IF s.phase NOT IN ('prepared','active') OR s.epoch IS DISTINCT FROM (p_args->>'epoch')::uuid OR s.payload_hash IS DISTINCT FROM p_args->>'hash' THEN RAISE EXCEPTION 'live-variable-activation-conflict'; END IF;
    UPDATE workflow_live_variable_state SET phase='active' WHERE owner_user_id=p_owner AND workflow_id=p_workflow;
    RETURN '{}'::jsonb;
  ELSIF p_operation='checkpoint' THEN
    e:=validate_live_variable_checkpoint(p_args->>'payload',p_args->>'hash',p_owner,p_workflow);
    IF s.phase='idle' OR e->>'epoch'<>s.epoch::text OR e->>'fence'<>s.producer_fence::text
      OR e->'parent' IS DISTINCT FROM s.payload::jsonb->'parent' THEN RAISE EXCEPTION 'live-variable-checkpoint-fence'; END IF;
    IF (e->>'generation')::bigint<s.generation THEN RAISE EXCEPTION 'live-variable-checkpoint-stale'; END IF;
    IF (e->>'generation')::bigint=s.generation THEN
      IF s.payload_hash<>p_args->>'hash' THEN RAISE EXCEPTION 'live-variable-checkpoint-hash-conflict'; END IF;
    ELSIF clock_timestamp()>=s.checkpoint_after OR (p_args->>'priority'='true' AND s.writer::text=p_args->>'writer' AND s.fence::text=p_args->>'fence') THEN
      UPDATE workflow_live_variable_state SET generation=(e->>'generation')::bigint,payload=p_args->>'payload',payload_hash=p_args->>'hash',
        checkpoint_after=clock_timestamp()+interval '2 seconds' WHERE owner_user_id=p_owner AND workflow_id=p_workflow RETURNING * INTO s;
    END IF;
    RETURN jsonb_build_object('generation',s.generation::text,'hash',s.payload_hash);
  ELSIF p_operation='handoff' THEN
    IF s.phase<>'active' OR s.epoch IS DISTINCT FROM (p_args->>'epoch')::uuid OR s.generation::text IS DISTINCT FROM p_args->>'generation' OR s.payload_hash IS DISTINCT FROM p_args->>'hash' THEN RAISE EXCEPTION 'live-variable-handoff-conflict'; END IF;
    DELETE FROM workflow_variables WHERE owner_user_id=p_owner AND workflow_id=p_workflow
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s.payload::jsonb->'snapshot'->'entries') x WHERE x->>'key'=workflow_variables.key);
    INSERT INTO workflow_variables(owner_user_id,workflow_id,key,value,value_type,updated_at,updated_by)
      SELECT p_owner,p_workflow,x->>'key',x->'value',x->>'value_type',(x->>'updated_at')::timestamptz,p_owner FROM jsonb_array_elements(s.payload::jsonb->'snapshot'->'entries') x
      ON CONFLICT(owner_user_id,workflow_id,key) WHERE workflow_id IS NOT NULL
      DO UPDATE SET value=EXCLUDED.value,value_type=EXCLUDED.value_type,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;
    UPDATE workflow_variable_revisions SET revision=revision+1 WHERE owner_user_id=p_owner;
    UPDATE workflow_live_variable_state SET phase='idle',writer=NULL,lease_until=NULL WHERE owner_user_id=p_owner AND workflow_id=p_workflow;
    RETURN jsonb_build_object('revision',(r+1)::text);
  END IF;
  RAISE EXCEPTION 'live-variable-operation';
END; $$;
REVOKE ALL ON FUNCTION public.workflow_live_variables(text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_live_variables(text,uuid,uuid,jsonb) TO service_role;

-- Preserve the legacy transaction/receipts intact behind a shared authority guard.
DO $$ BEGIN
  IF to_regprocedure('public.commit_workflow_variables_legacy(uuid,uuid,text,text,jsonb)') IS NULL THEN
    ALTER FUNCTION public.commit_workflow_variables(uuid,uuid,text,text,jsonb) RENAME TO commit_workflow_variables_legacy;
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.commit_workflow_variables_legacy(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.commit_workflow_variables(p_owner uuid,p_workflow uuid,p_expected_revision text,p_token text,p_changes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE active_phase text;
BEGIN
  PERFORM workflow_variables_revision(p_owner,p_workflow);
  INSERT INTO workflow_variable_revisions(owner_user_id) VALUES(p_owner) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM workflow_variable_revisions WHERE owner_user_id=p_owner FOR UPDATE;
  SELECT phase INTO active_phase FROM workflow_live_variable_state WHERE owner_user_id=p_owner AND workflow_id=p_workflow FOR UPDATE;
  IF active_phase IS NOT NULL AND active_phase<>'idle' THEN RAISE EXCEPTION 'live-variable-scope-owned' USING ERRCODE='40001'; END IF;
  RETURN commit_workflow_variables_legacy(p_owner,p_workflow,p_expected_revision,p_token,p_changes);
END; $$;
REVOKE ALL ON FUNCTION public.commit_workflow_variables(uuid,uuid,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.commit_workflow_variables(uuid,uuid,text,text,jsonb) TO authenticated,service_role;

-- Flag-off cannot read an old legacy cache or silently admit a competing writer.
CREATE OR REPLACE FUNCTION public.workflow_variables_revision(p_owner uuid,p_workflow uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF (auth.role()='service_role' OR auth.uid()=p_owner) IS NOT TRUE OR NOT EXISTS (SELECT 1 FROM workflows WHERE id=p_workflow AND user_id=p_owner) THEN RAISE EXCEPTION 'variable-workflow-denied' USING ERRCODE='42501'; END IF;
  IF EXISTS (SELECT 1 FROM workflow_live_variable_state WHERE owner_user_id=p_owner AND workflow_id=p_workflow AND phase<>'idle') THEN RAISE EXCEPTION 'live-variable-scope-owned; drain or recover before synchronous execution' USING ERRCODE='40001'; END IF;
  RETURN coalesce((SELECT revision FROM workflow_variable_revisions WHERE owner_user_id=p_owner),0)::text;
END; $$;
