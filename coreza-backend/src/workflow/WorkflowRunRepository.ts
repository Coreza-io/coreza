import { supabase } from "../config/supabase";
import { createError } from "../middleware/errorHandler";
import { WorkflowEdge, WorkflowNode } from "../nodes/types";

export class WorkflowRunRepository {
  async createRun(
    workflowId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
  ) {
    const { data, error } = await supabase
      .from("workflow_runs")
      .insert({
        workflow_id: workflowId,
        status: "queued",
        initiated_by: userId,
        nodes,
        edges,
        node_count: Array.isArray(nodes) ? nodes.length : 0,
        edge_count: Array.isArray(edges) ? edges.length : 0,
      })
      .select()
      .single();

    if (error) {
      throw createError("Failed to create workflow run", 500);
    }

    return data;
  }

  async markRunFailed(runId: string, errorMessage: string): Promise<void> {
    const { error } = await supabase
      .from("workflow_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: errorMessage,
      })
      .eq("id", runId);

    if (error) {
      throw createError("Failed to update workflow run status", 500);
    }
  }

  async listByWorkflow(workflowId: string) {
    const { data, error } = await supabase
      .from("workflow_runs")
      .select("*")
      .eq("workflow_id", workflowId)
      .order("started_at", { ascending: false });

    if (error) {
      throw createError("Failed to fetch workflow runs", 500);
    }

    return data;
  }

  async getRunStatus(workflowId: string, runId: string) {
    const { data, error } = await supabase
      .from("workflow_runs")
      .select("*")
      .eq("id", runId)
      .eq("workflow_id", workflowId)
      .single();

    if (error || !data) {
      throw createError("Workflow run not found", 404);
    }

    return data;
  }

  async getNodeExecutions(workflowId: string, runId: string) {
    await this.getRunStatus(workflowId, runId);

    const { data, error } = await supabase
      .from("node_executions")
      .select("*")
      .eq("run_id", runId)
      .order("started_at", { ascending: true });

    if (error) {
      throw createError("Failed to fetch node executions", 500);
    }

    return data;
  }

  async getNodeExecutionCount(runId: string): Promise<number> {
    const { count, error } = await supabase
      .from("node_executions")
      .select("*", { count: "exact", head: true })
      .eq("run_id", runId);

    if (error) {
      return 0;
    }

    return count || 0;
  }

  async cancelActiveRuns(workflowId: string) {
    const { data, error } = await supabase
      .from("workflow_runs")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error_message: "Workflow deactivated by user",
      })
      .eq("workflow_id", workflowId)
      .in("status", ["running", "queued"])
      .select("id");

    if (error) {
      throw createError("Failed to cancel workflow runs", 500);
    }

    return data?.length || 0;
  }

  async cancelActiveBacktests(workflowId: string) {
    const { data: active, error } = await supabase
      .from("backtests")
      .select("id")
      .eq("workflow_id", workflowId)
      .in("status", ["pending", "running"]);

    if (error) {
      throw createError("Failed to fetch active backtests", 500);
    }

    if (active?.length) {
      const { error: updateError } = await supabase
        .from("backtests")
        .update({
          status: "cancelled",
          completed_at: new Date().toISOString(),
          error_message: "Workflow deactivated by user",
        })
        .eq("workflow_id", workflowId)
        .in("status", ["pending", "running"]);

      if (updateError) {
        throw createError("Failed to cancel backtests", 500);
      }
    }

    return active?.length || 0;
  }
}
