import { serializeWorkflowRunResult } from "../utils/workflowRunResultContract";
import { supabase } from "../config/supabase";
import { createError } from "../middleware/errorHandler";
import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import type { WorkflowExecutionResult } from "../engine/types";
import type { Database } from "../types/supabase";

type WorkflowRunRow = Database["public"]["Tables"]["workflow_runs"]["Row"];
const COMPLETED_RUN_STATUSES = ["success", "failed", "cancelled"];
const BACKTEST_PARENT = "scope_snapshot->>backtestParentRunId";
const HISTORY_DELETE_BATCH_SIZE = 50;

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
      .eq("id", runId).eq("workflow_id", workflowId).eq("initiated_by", userId).is("scope_snapshot->>backtestParentRunId", null)
      .in("status", ["queued", "running"]).select("id").maybeSingle();
    if (error) throw createError("Failed to finalize backtest run", 500);
    if (data) return true;
    const now = new Date().toISOString();
    const cancellationMessage = errorMessage ?? "Run cancelled by user";
    const cancelledResult = result && serializeWorkflowRunResult({
      ...result,
      success: false,
      error: result.error ?? { code: "CANCELLED", message: cancellationMessage, phase: "execute" },
    });
    const { data: cancelled, error: cancelError } = await supabase.schema("public").from("workflow_runs")
      .update({
        status: "cancelled", completed_at: now, cancel_acknowledged_at: now,
        error_message: cancellationMessage,
        ...(cancelledResult ? { result: cancelledResult } : {}),
      })
      .eq("id", runId).eq("workflow_id", workflowId).eq("initiated_by", userId).is("scope_snapshot->>backtestParentRunId", null)
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
      .eq("id", runId).eq("workflow_id", workflowId).eq("initiated_by", userId).is("scope_snapshot->>backtestParentRunId", null).single();
    if (error || !data) throw createError("Workflow run not found", 404);
    return data as { id: string; status: string; scope_snapshot: { memberNodeIds?: unknown } | null };
  }

  async requestCancellation(runId: string): Promise<void> {
    const { error } = await (supabase.from("workflow_runs") as any).update({
      status: "cancelling", cancel_requested_at: new Date().toISOString(), error_message: null,
    }).eq("id", runId).is("scope_snapshot->>backtestParentRunId", null).in("status", ["pending", "queued", "running"]);
    if (error) throw createError("Failed to request workflow cancellation", 500);
  }

  async markRunCancelled(runId: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await (supabase.from("workflow_runs") as any).update({
      status: "cancelled", cancel_acknowledged_at: now, completed_at: now, error_message: "Run cancelled by user",
    }).eq("id", runId).is("scope_snapshot->>backtestParentRunId", null).eq("status", "cancelling");
    if (error) throw createError("Failed to cancel workflow run", 500);
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
    }).eq("id", runId).is("scope_snapshot->>backtestParentRunId", null).eq("status", "cancelling");
    if (error) throw createError("Failed to finalize workflow cancellation", 500);
  }

  async markRunFailed(runId: string, errorMessage: string): Promise<void> {
    const { error } = await (supabase.from("workflow_runs") as any)
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: errorMessage,
      })
      .eq("id", runId).is("scope_snapshot->>backtestParentRunId", null);

    if (error) {
      throw createError("Failed to update workflow run status", 500);
    }
  }

  async listByWorkflow(workflowId: string) {
    const { data, error } = await supabase
      .from("workflow_runs")
      .select("*")
      .eq("workflow_id", workflowId)
      .is("scope_snapshot->>backtestParentRunId", null)
      .order("started_at", { ascending: false });

    if (error) {
      throw createError("Failed to fetch workflow runs", 500);
    }

    return data;
  }

  async clearExecutionHistory(workflowId: string, backtestRunId?: string): Promise<number> {
    if (backtestRunId) {
      const { data: run, error } = await supabase.from("workflow_runs")
        .select("status,scope_snapshot").eq("workflow_id", workflowId)
        .eq("id", backtestRunId).is(BACKTEST_PARENT, null).maybeSingle()
        .overrideTypes<Pick<WorkflowRunRow, "status" | "scope_snapshot">, { merge: false }>();
      if (error) throw createError("Failed to find backtest history", 500);
      if (!run) throw createError("Backtest run not found", 404);
      if (run.scope_snapshot?.executionMode !== "backtest" && run.scope_snapshot?.barHistory !== true) {
        const { data: bars, error: barsError } = await supabase.from("workflow_runs")
          .select("id").eq("workflow_id", workflowId).eq(BACKTEST_PARENT, backtestRunId).limit(1);
        if (barsError) throw createError("Failed to find backtest history", 500);
        if (!bars?.length) throw createError("Backtest run not found", 404);
      }
      if (!COMPLETED_RUN_STATUSES.includes(run.status)) {
        throw createError("Wait for the backtest to finish before clearing its history", 409);
      }
      return this.deleteCompletedRuns(workflowId, [backtestRunId]);
    }

    const cutoff = new Date().toISOString();
    let deleted = 0;
    let cursor: string | undefined;
    for (;;) {
      let query = supabase.from("workflow_runs").select("id")
        .eq("workflow_id", workflowId).is(BACKTEST_PARENT, null)
        .in("status", COMPLETED_RUN_STATUSES)
        .or(`completed_at.is.null,completed_at.lte.${cutoff}`)
        .order("id").limit(HISTORY_DELETE_BATCH_SIZE);
      if (cursor) query = query.gt("id", cursor);
      const { data: runs, error } = await query.overrideTypes<Pick<WorkflowRunRow, "id">[], { merge: false }>();
      if (error) throw createError("Failed to find completed execution history", 500);
      const ids = (runs ?? []).map(run => run.id);
      if (!ids.length) return deleted;
      deleted += await this.deleteCompletedRuns(workflowId, ids);
      cursor = ids[ids.length - 1];
    }
  }

  private async deleteCompletedRuns(workflowId: string, rootIds: string[]): Promise<number> {
    // Delete parent snapshots and their historical bars in the same statement.
    const ids = rootIds.join(",");
    const { count, error } = await supabase.from("workflow_runs").delete({ count: "exact" })
      .eq("workflow_id", workflowId).in("status", COMPLETED_RUN_STATUSES)
      .or(`id.in.(${ids}),${BACKTEST_PARENT}.in.(${ids})`);
    if (error) throw createError("Failed to clear execution history", 500);
    return count ?? 0;
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
      .is("scope_snapshot->>backtestParentRunId", null)
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
