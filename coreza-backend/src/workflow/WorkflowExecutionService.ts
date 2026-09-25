import { bullMqJobQueue as jobQueue } from "../infra/jobQueue/jobQueueManager";
import { ClusterWorkflowSnapshot, compileClusterExecutionPlan } from "./clusterExecution";
import { WorkflowRepository } from "./WorkflowRepository";
import { WorkflowRunRepository } from "./WorkflowRunRepository";
import { ExecuteWorkflowInput } from "./schemas";
import { createError } from "../middleware/errorHandler";
import { createHash } from "crypto";

function requestError(code: string, statusCode: number) {
  return Object.assign(createError(code, statusCode), { code });
}

function requestFingerprint(value: unknown): string {
  const normalize = (item: unknown): unknown => Array.isArray(item)
    ? item.map(normalize)
    : item !== null && typeof item === "object"
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]))
      : item;
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

export class WorkflowExecutionService {
  constructor(
    private workflowRepo: WorkflowRepository,
    private runRepo: WorkflowRunRepository,
  ) {}

  async executeManual(
    userId: string,
    workflowId: string,
    request: ExecuteWorkflowInput,
  ) {
    const workflow = await this.workflowRepo.getOwnedWorkflow(
      userId,
      workflowId,
    ) as unknown as ClusterWorkflowSnapshot;
    if (workflow.revision !== request.expected_revision) {
      throw requestError("revision_conflict", 409);
    }
    if (request.scope.kind === "cluster" && !request.idempotency_key) {
      throw requestError("idempotency_key_required", 400);
    }
    const plan = request.scope.kind === "cluster"
      ? compileClusterExecutionPlan({
          workflow,
          clusterId: request.scope.clusterId,
          boundaryInputs: Object.fromEntries(
            Object.entries(request.boundary_inputs ?? {}).map(
              ([edgeId, value]) => [edgeId, { value, provenance: "explicit" as const }],
            ),
          ),
          referenceSnapshots: request.reference_snapshots,
        })
      : undefined;
    if (!plan && (request.boundary_inputs || request.reference_snapshots)) {
      throw requestError("scope_inputs_require_cluster", 400);
    }
    const fingerprint = requestFingerprint({
      workflowId,
      sourceRevision: workflow.revision,
      scope: request.scope,
      planHash: plan?.planHash,
      boundaryInputs: request.boundary_inputs ?? {},
      referenceSnapshots: request.reference_snapshots ?? {},
      pinnedResults: plan?.pinnedResults ?? {},
    });
    if (request.idempotency_key) {
      const existing = await this.runRepo.findIdempotentRun(workflowId, userId, request.idempotency_key);
      if (existing) {
        if (existing.request_fingerprint !== fingerprint) throw requestError("idempotency_key_conflict", 409);
        return { run_id: existing.id, status: existing.status, message: "Existing workflow execution returned" };
      }
    }

    const nodes = plan
      ? workflow.nodes.filter((node) => plan.memberNodeIds.includes(node.id))
      : workflow.nodes;
    const edges = plan ? [...plan.internalMainEdges, ...plan.internalAttachmentEdges] : workflow.edges;
    const run = await this.runRepo.createRun(workflowId, userId, nodes, edges, workflow.node_clusters, workflow.revision, {
      scopeKind: request.scope.kind,
      scopeClusterId: plan?.clusterId,
      scopeSnapshot: plan ? {
        title: plan.titleSnapshot,
        memberNodeIds: plan.memberNodeIds,
        planHash: plan.planHash,
        boundaryInputs: plan.entryActivations.flatMap(({ inputs }) =>
          inputs.map(({ edgeId, provenance }) => ({ edgeId, provenance }))),
        boundaryOutputs: plan.boundaryOutputEdges,
      } : {},
      idempotencyKey: request.idempotency_key,
      requestFingerprint: fingerprint,
    });
    const runRecord = run as unknown as {
      id: string;
      status?: string;
      idempotent_existing?: boolean;
    };
    const runId = runRecord.id;
    if (runRecord.idempotent_existing) {
      return {
        run_id: runId,
        status: runRecord.status ?? "queued",
        message: "Existing workflow execution returned",
      };
    }

    try {
      await jobQueue.addWorkflowExecution({
        runId, rootRunId: runId, workflowId, userId, nodes, edges,
        trigger: "manual", executionMode: "manual", initialInput: request.input_data,
        scope: request.scope, sourceRevision: workflow.revision, planHash: plan?.planHash,
        failurePolicy: plan?.failurePolicy ?? "best-effort", entryActivations: plan?.entryActivations,
        referenceContext: plan?.referenceContext, pinnedResults: plan?.pinnedResults,
        boundaryOutputEdges: plan?.boundaryOutputEdges, allowedExecutableNodeIds: plan?.executableNodeIds,
      });
    } catch (error) {
      await this.runRepo.markRunFailed(
        runId,
        error instanceof Error ? error.message : "Failed to enqueue workflow run",
      );
      throw error;
    }
    return { run_id: runId, status: "queued", message: "Workflow execution queued" };
  }

  async cancelManualRun(userId: string, workflowId: string, runId: string) {
    const run = await this.runRepo.getOwnedRun(userId, workflowId, runId);
    if (["success", "failed", "cancelled"].includes(run.status)) {
      return { run_id: runId, status: run.status, cancelled: run.status === "cancelled" };
    }
    await this.runRepo.requestCancellation(runId);
    await jobQueue.cancelWorkflowRun(userId, workflowId, runId);
    await this.runRepo.markRunCancelled(runId);
    return { run_id: runId, status: "cancelled", cancelled: true };
  }
}
