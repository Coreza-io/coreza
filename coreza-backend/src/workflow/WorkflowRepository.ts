import { supabase } from "../config/supabase";
import { createError } from "../middleware/errorHandler";
import { createLogger } from "../utils/logger";
import { CreateWorkflowInput, UpdateWorkflowInput } from "./schemas";

const logger = createLogger("WorkflowRepository");

interface WorkflowRpcError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

function mapWorkflowSaveError(error: WorkflowRpcError) {
  logger.error(
    {
      code: error.code,
      details: error.details,
      hint: error.hint,
      rpcMessage: error.message,
    },
    "save_workflow_document failed",
  );

  if (error.message.includes("workflow-revision-conflict") || error.code === "40001") {
    return createError("workflow-revision-conflict", 409);
  }
  if (error.message.includes("expression-writer-upgrade-required")) return createError("expression-writer-upgrade-required", 409);
  if (error.message.includes("cluster-writer-upgrade-required")) return createError("cluster-writer-upgrade-required", 409);
  if (error.message.includes("workflow-not-found")) {
    return createError("Workflow not found", 404);
  }
  if (error.message.includes("empty-workflow")) {
    return createError("A saved workflow cannot be empty", 400);
  }

  const mapped = createError("Failed to update workflow", 500);
  mapped.code = "WORKFLOW_SAVE_FAILED";
  mapped.details = { databaseCode: error.code ?? "unknown" };
  return mapped;
}

export class WorkflowRepository {
  async expressionReady(): Promise<boolean> {
    const { data, error } = await (supabase.rpc as any)('expression_workflow_write_ready');
    return !error && data === true;
  }
  async hierarchyReady(): Promise<boolean> {
    const { data, error } = await (supabase.rpc as any)('cluster_hierarchy_write_ready');
    return !error && data === true;
  }

  async getOwnedWorkflow(userId: string, workflowId: string, select = "*") {
    const { data, error } = await supabase
      .from("workflows")
      .select(select)
      .eq("id", workflowId)
      .eq("user_id", userId)
      .single();

    if (error?.code === "PGRST116" || !data) {
      throw createError("Workflow not found", 404);
    }

    if (error) {
      throw createError((error as any).message, 500);
    }

    return data;
  }

  async listByUser(userId: string) {
    const { data, error } = await supabase
      .from("workflows")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      throw createError("Failed to fetch workflows", 500);
    }

    return data;
  }

  async create(userId: string, input: CreateWorkflowInput) {
    const { data, error } = await supabase
      .from("workflows")
      .insert({
        user_id: userId,
        name: input.name,
        nodes: input.nodes,
        edges: input.edges,
        project_id: input.project_id,
        schedule_cron: input.schedule_cron,
        node_clusters: input.node_clusters,
        is_active: false,
      } as any)
      .select()
      .single();

    if (error) {
      throw createError("Failed to create workflow", 500);
    }

    return data;
  }

  async update(userId: string, workflowId: string, input: UpdateWorkflowInput) {
    const { expected_revision, ...candidate } = input;
    const { data, error } = await (supabase.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: WorkflowRpcError | null}>)("save_workflow_document", {
        p_workflow_id: workflowId,
        p_user_id: userId,
        p_expected_revision: expected_revision,
        p_name: candidate.name,
        p_nodes: candidate.nodes,
        p_edges: candidate.edges,
        p_node_clusters: candidate.node_clusters,
        p_project_id: candidate.project_id,
        ...(candidate.cluster_format_version === 2 ? { p_cluster_format_version: 2 } : {}),
      });

    if (error) {
      throw mapWorkflowSaveError(error);
    }

    if (!data) {
      throw createError("Workflow not found", 404);
    }

    return data;
  }

  async delete(userId: string, workflowId: string) {
    const { error } = await supabase
      .from("workflows")
      .delete()
      .eq("id", workflowId)
      .eq("user_id", userId);

    if (error) {
      throw createError("Failed to delete workflow", 500);
    }
  }

  async setActivationState(
    userId: string,
    workflowId: string,
    isActive: boolean,
    scheduleCron: string | null = null,
    activeExecutionId: string | null = null,
  ) {
    const updatePayload: Record<string, any> = {
      is_active: isActive,
      schedule_cron: isActive ? scheduleCron : null,
      updated_at: new Date().toISOString(),
    };

    if (isActive) {
      updatePayload.active_execution_id = activeExecutionId;
    }

    const { data, error } = await (supabase.from("workflows") as any)
      .update(updatePayload)
      .eq("id", workflowId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error || !data) {
      throw createError("Failed to update workflow", 500);
    }

    return data;
  }
}
