-- Workflow documents are written only by the service-role backend. Ownership RLS
-- remains in place for reads and deletes, but is not a semantic validation layer.
REVOKE INSERT, UPDATE ON TABLE public.workflows FROM anon, authenticated;

ALTER TABLE public.workflow_runs
  ADD COLUMN IF NOT EXISTS source_workflow_revision bigint;

DROP FUNCTION IF EXISTS public.save_workflow_document(uuid, uuid, bigint, text, jsonb, jsonb, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.save_workflow_document(
  p_workflow_id uuid,
  p_user_id uuid,
  p_expected_revision bigint,
  p_name text DEFAULT NULL,
  p_nodes jsonb DEFAULT NULL,
  p_edges jsonb DEFAULT NULL,
  p_node_clusters jsonb DEFAULT NULL,
  p_project_id uuid DEFAULT NULL
) RETURNS public.workflows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_row public.workflows%ROWTYPE;
  next_name text;
  next_nodes jsonb;
  next_edges jsonb;
  next_clusters jsonb;
  next_project_id uuid;
  next_version integer;
BEGIN
  SELECT * INTO current_row FROM public.workflows
    WHERE id = p_workflow_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow-not-found'; END IF;
  IF current_row.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'workflow-revision-conflict' USING ERRCODE = '40001';
  END IF;

  next_name := COALESCE(p_name, current_row.name);
  next_nodes := COALESCE(p_nodes, current_row.nodes);
  next_edges := COALESCE(p_edges, current_row.edges);
  next_clusters := COALESCE(p_node_clusters, current_row.node_clusters);
  next_project_id := p_project_id;

  IF jsonb_array_length(current_row.nodes) > 0 AND jsonb_array_length(next_nodes) = 0 THEN
    RAISE EXCEPTION 'empty-workflow';
  END IF;

  IF next_name = current_row.name AND next_nodes = current_row.nodes
     AND next_edges = current_row.edges AND next_clusters = current_row.node_clusters
     AND next_project_id IS NOT DISTINCT FROM current_row.project_id THEN
    RETURN current_row;
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO next_version
    FROM public.workflow_versions WHERE workflow_id = p_workflow_id;
  INSERT INTO public.workflow_versions
    (workflow_id, version_number, name, nodes, edges, node_clusters, is_active,
     node_count, edge_count, created_by)
  VALUES
    (current_row.id, next_version, current_row.name, current_row.nodes,
     current_row.edges, current_row.node_clusters, current_row.is_active,
     jsonb_array_length(current_row.nodes), jsonb_array_length(current_row.edges), p_user_id);

  UPDATE public.workflows SET
    name = next_name, nodes = next_nodes, edges = next_edges,
    node_clusters = next_clusters, project_id = next_project_id,
    revision = revision + 1, updated_at = now()
  WHERE id = current_row.id
  RETURNING * INTO current_row;
  RETURN current_row;
END;
$$;

REVOKE ALL ON FUNCTION public.save_workflow_document(uuid, uuid, bigint, text, jsonb, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_workflow_document(uuid, uuid, bigint, text, jsonb, jsonb, jsonb, uuid)
  TO service_role;