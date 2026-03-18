import { supabase } from "../config/supabase";
import { createError } from "../middleware/errorHandler";
import { CreateWorkflowInput, UpdateWorkflowInput } from "./schemas";

export class WorkflowRepository {
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
      throw createError(error.message, 500);
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
        is_active: false,
      })
      .select()
      .single();

    if (error) {
      throw createError("Failed to create workflow", 500);
    }

    return data;
  }

  async update(userId: string, workflowId: string, input: UpdateWorkflowInput) {
    const { data, error } = await supabase
      .from("workflows")
      .update({
        ...input,
        updated_at: new Date().toISOString(),
      })
      .eq("id", workflowId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      throw createError("Failed to update workflow", 500);
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
  ) {
    const { data, error } = await supabase
      .from("workflows")
      .update({
        is_active: isActive,
        schedule_cron: isActive ? scheduleCron : null,
        updated_at: new Date().toISOString(),
      })
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
