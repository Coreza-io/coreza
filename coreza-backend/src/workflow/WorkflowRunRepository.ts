import { serializeWorkflowRunResult } from "../utils/workflowRunResultContract";
import { supabase } from "../config/supabase";
import { createError } from "../middleware/errorHandler";
import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import type { WorkflowExecutionResult } from "../engine/types";

export class WorkflowRunRepository {
  async finishBacktestRun(
    userId: string, workflowId: string, runId: string,
    status: "success" | "failed", errorMessage: string | null = null,
    result?: WorkflowExecutionResult,
  ): Promise<boolean> {
    const { data, error } = await (supabase.from("workflow_runs") as any)
      .update({ status, completed_at: new Date().toISOString(), error_message: errorMessage,
        ...(result ? { result: serializeWorkflowRunResult(result) } : {}),
      })
      .eq("id", runId).eq("workflow_id", workflowId).eq("initiated_by", userId).is("parent_run_id", null)
      .in("status", ["queued", "running"]).select("id").maybeSingle();
    if (error) throw createError("Failed to finalize backtest run", 500);
    if (data) return true;
    const now = new Date().toISOString();
    const { data: cancelled, error: cancelError } = await supabase.schema("public").from("workflow_runs")
      .update({
        status: "cancelled", completed_at: now, cancel_acknowledged_at: now,
        error_message: errorMessage ?? "Run cancelled by user",
        ...(result ? { result: serializeWorkflowRunResult(result) } : {}),
      })
      .eq("id", runId).eq("workflow_id", workflowId).eq("initiated_by", userId).is("parent_run_id", null)
      .in("status", ["cancelling", "cancelled"]).select("id").maybeSingle();
    if (cancelError) throw createError("Failed to finalize backtest cancellation", 500);
    if (!cancelled) throw createError("Backtest run is no longer executable", 409);
    return false;
  }

  async createRun(
    workflowId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    nodeClusters: unknown = [],
    sourceWorkflowRevision?: number,
    scope: {
      scopeKind: "workflow" | "cluster";
      scopeClusterId?: string;
      scopeSnapshot: Record<string, unknown>;
      idempotencyKey?: string;
      requestFingerprint?: string;
    } = { scopeKind: "workflow", scopeSnapshot: {} },
  ) {
    const { data, error } = await supabase
      .from("workflow_runs")
      .insert({
        workflow_id: workflowId,
        status: "queued",
        initiated_by: userId,
        nodes,
        edges,
        node_clusters: nodeClusters,
        source_workflow_revision: sourceWorkflowRevision,
        scope_kind: scope.scopeKind,
        scope_cluster_id: scope.scopeClusterId,
        scope_snapshot: scope.scopeSnapshot,
        idempotency_key: scope.idempotencyKey,
        request_fingerprint: scope.requestFingerprint,
        node_count: Array.isArray(nodes) ? nodes.length : 0,
        edge_count: Array.isArray(edges) ? edges.length : 0,
      } as any)
      .select()
      .single();

    if (error?.code === "23505" && scope.idempotencyKey) {
      const existing = await this.findIdempotentRun(
        workflowId,
        userId,
        scope.idempotencyKey,
      );
      if (existing) return { ...existing, idempotent_existing: true };
    }
    if (error) {
      throw createError("Failed to create workflow run", 500);
    }

    return data;
  }

  async findIdempotentRun(workflowId: string, userId: string, idempotencyKey: string) {
    const { data, error } = await supabase.from("workflow_runs").select("id,status,request_fingerprint")
      .eq("workflow_id", workflowId).eq("initiated_by", userId).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (error) throw createError("Failed to inspect workflow run", 500);
    return data as { id: string; status: string; request_fingerprint: string | null } | null;
  }

  async getOwnedRun(userId: string, workflowId: string, runId: string) {
    const { data, error } = await supabase.from("workflow_runs").select("id,status,scope_snapshot")
      .eq("id", runId).eq("workflow_id", workflowId).eq("initiated_by", userId).is("parent_run_id", null).single();
    if (error || !data) throw createError("Workflow run not found", 404);
    return data as { id: string; status: string; scope_snapshot: { memberNodeIds?: unknown; executionMode?: string } | null };
  }

  async waitForBacktestCancellation(userId: string, workflowId: string, runId: string) {
    const deadline = performance.now() + 5_000;
    let run = await this.getOwnedRun(userId, workflowId, runId);
    while (run.status === "cancelling" && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 500));
      run = await this.getOwnedRun(userId, workflowId, runId);
    }
    return run;
  }

  async requestCancellation(runId: string): Promise<void> {
    const { error } = await (supabase.from("workflow_runs") as any).update({
      status: "cancelling", cancel_requested_at: new Date().toISOString(), error_message: null,
    }).eq("id", runId).is("parent_run_id", null).in("status", ["pending", "queued", "running"]);
    if (error) throw createError("Failed to request workflow cancellation", 500);
  }

  async finalizeQueuedCancellation(runId: string, memberNodeIds: readonly string[]): Promise<void> {
    const now = new Date().toISOString();
    const nodeOutcomes = Object.fromEntries(memberNodeIds.map((nodeId) => [nodeId, "cancelled"]));
    const { error } = await (supabase.from("workflow_runs") as any).update({
      status: "cancelled",
      cancel_acknowledged_at: now,
      completed_at: now,
      error_message: "Run cancelled by user",
      result: {
        success: false,
        resultFinalized: true,
        nodeResults: {},
        executionOrder: [],
        nodeOutcomes,
        error: { code: "CANCELLED", message: "Run cancelled by user", phase: "queue", retryable: false },
      },
    }).eq("id", runId).is("parent_run_id", null).eq("status", "cancelling");
    if (error) throw createError("Failed to finalize workflow cancellation", 500);
  }

  async markRunFailed(runId: string, errorMessage: string): Promise<void> {
    const { error } = await (supabase.from("workflow_runs") as any)
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: errorMessage,
      })
      .eq("id", runId).is("parent_run_id", null);

    if (error) {
      throw createError("Failed to update workflow run status", 500);
    }
  }

  async listByWorkflow(workflowId: string) {
    const { data, error } = await supabase
      .from("workflow_runs")
      .select("*")
      .eq("workflow_id", workflowId)
      .is("parent_run_id", null)
      .order("started_at", { ascending: false });

    if (error) {
      throw createError("Failed to fetch workflow runs", 500);
    }

    return data;
  }

  async getRunStatus(workflowId: string, runId: string) {
    const { data, error } = await supabase
      .from("workflow_runs")
      .select("id,workflow_id,status,error_message,result,source_workflow_revision,scope_kind,scope_cluster_id,scope_snapshot,started_at,completed_at")
      .eq("id", runId)
      .eq("workflow_id", workflowId)
      .single();

    if (error || !data) {
      throw createError("Workflow run not found", 404);
    }

    return data;
  }

  // Per-node SQL history is retired. Keep the existing response shape for
  // callers while preserving the workflow/run access checks above this layer.
  async getNodeExecutions(workflowId: string, runId: string) {
    await this.getRunStatus(workflowId, runId);
    return [];
  }

  async getNodeExecutionCount(_runId: string): Promise<number> {
    return 0;
  }

  async cancelActiveRuns(workflowId: string) {
    const { data, error } = await (supabase.from("workflow_runs") as any)
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        error_message: "Workflow deactivated by user",
      })
      .eq("workflow_id", workflowId)
      .is("parent_run_id", null)
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
      const { error: updateError } = await (supabase.from("backtests") as any)
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
