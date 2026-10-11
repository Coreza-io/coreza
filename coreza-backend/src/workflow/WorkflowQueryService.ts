import { validateExpressionDocument } from "./expressionDocument";
import type { WorkflowNode } from "../nodes/types";
import type { SchedulerLifecycleAdapter } from "./SchedulerLifecycleAdapter";
import type { CreateWorkflowInput, UpdateWorkflowInput } from "./schemas";
import type { WorkflowRepository } from "./WorkflowRepository";
import type { WorkflowRunRepository } from "./WorkflowRunRepository";
import { validateNodeClusterDocument } from "./validateNodeClusters";

export class WorkflowQueryService {
  constructor(
    private workflowRepo: WorkflowRepository,
    private runRepo: WorkflowRunRepository,
    private scheduler: SchedulerLifecycleAdapter,
  ) {}

  async getCapabilities() {
    const ready = await this.workflowRepo.hierarchyReady();
    return {
      expression_format_version: process.env.COREZA_EXPRESSION_AUTHORING !== 'disabled' && await this.workflowRepo.expressionReady?.() ? 1 : 0,
      cluster_format_version: ready ? 2 : 1,
      max_cluster_depth: ready ? 2 : 1,
    };
  }

  private async protectHierarchy(
    input: {
      cluster_format_version?: number;
      nodes?: unknown;
      edges?: unknown;
      node_clusters?: CreateWorkflowInput["node_clusters"];
    },
    existing: CreateWorkflowInput["node_clusters"] = [],
  ) {
    const nestedCandidate = input.node_clusters?.some(
      (c) => c.parentClusterId !== undefined,
    );
    const existingNested = existing.some((c) => c.parentClusterId !== undefined);
    const replacingNested =
      existingNested &&
      (input.nodes !== undefined ||
        input.edges !== undefined ||
        input.node_clusters !== undefined);
    if (nestedCandidate || replacingNested) {
      if (input.cluster_format_version !== 2)
        throw Object.assign(new Error("cluster-writer-upgrade-required"), {
          statusCode: 409,
          isOperational: true,
        });
    }
    if (nestedCandidate || existingNested) {
      if (!(await this.workflowRepo.hierarchyReady()))
        throw Object.assign(new Error("cluster-hierarchy-unavailable"), {
          statusCode: 409,
          isOperational: true,
        });
    }
    return !!(nestedCandidate || existingNested);
  }

  async listWorkflows(userId: string) {
    return this.workflowRepo.listByUser(userId);
  }

  async getWorkflow(userId: string, workflowId: string) {
    return this.workflowRepo.getOwnedWorkflow(userId, workflowId);
  }

  async createWorkflow(userId: string, input: CreateWorkflowInput) {
    validateExpressionDocument(input.nodes as WorkflowNode[]);
    await this.protectHierarchy(input);
    const nodeClusters = validateNodeClusterDocument({
      nodes: input.nodes,
      edges: input.edges,
      node_clusters: input.node_clusters,
    });
    return this.workflowRepo.create(userId, {
      ...input,
      node_clusters: nodeClusters,
    });
  }

  async updateWorkflow(
    userId: string,
    workflowId: string,
    input: UpdateWorkflowInput,
  ) {
    const existing = (await this.workflowRepo.getOwnedWorkflow(
      userId,
      workflowId,
      "name,nodes,edges,node_clusters,project_id,revision",
    )) as {
      name: string;
      nodes?: Array<{ id?: unknown }>;
      edges?: Array<{ id?: unknown; source?: unknown; target?: unknown }>;
      node_clusters?: CreateWorkflowInput["node_clusters"];
      project_id: string | null;
      revision: number;
    };
    if (input.expected_revision !== existing.revision) {
      throw Object.assign(new Error("workflow-revision-conflict"), {
        statusCode: 409,
        isOperational: true,
      });
    }
    const hierarchyWrite = await this.protectHierarchy(input, existing.node_clusters);
    const candidateNodes = input.nodes ?? existing.nodes ?? [];
    validateExpressionDocument(candidateNodes as WorkflowNode[], existing.nodes as WorkflowNode[] ?? []);
    if ((existing.nodes?.length ?? 0) > 0 && candidateNodes.length === 0) {
      throw Object.assign(new Error("empty-workflow"), {
        statusCode: 400,
        isOperational: true,
      });
    }
    const nodeClusters = validateNodeClusterDocument({
      nodes: candidateNodes,
      edges: input.edges ?? existing.edges ?? [],
      node_clusters: input.node_clusters ?? existing.node_clusters ?? [],
    });
    return this.workflowRepo.update(userId, workflowId, {
      ...input,
      // Flat writes need no new RPC argument and must work before migration,
      // even when a capable client supplied its format declaration. Nested
      // metadata-only updates forward the server's supported snapshot as well.
      cluster_format_version: hierarchyWrite ? 2 : undefined,
      name: input.name ?? existing.name,
      nodes: candidateNodes,
      edges: input.edges ?? existing.edges ?? [],
      node_clusters: nodeClusters,
      project_id:
        input.project_id !== undefined ? input.project_id : existing.project_id,
    });
  }

  async getWorkflowRuns(userId: string, workflowId: string) {
    await this.workflowRepo.getOwnedWorkflow(userId, workflowId, "id");
    return this.runRepo.listByWorkflow(workflowId);
  }

  async getRunStatus(userId: string, workflowId: string, runId: string) {
    await this.workflowRepo.getOwnedWorkflow(userId, workflowId, "id");
    const run = await this.runRepo.getRunStatus(workflowId, runId);
    const count = await this.runRepo.getNodeExecutionCount(runId);

    return {
      run,
      node_executions_count: count,
    };
  }

  async getNodeExecutions(userId: string, workflowId: string, runId: string) {
    await this.workflowRepo.getOwnedWorkflow(userId, workflowId, "id");
    return this.runRepo.getNodeExecutions(workflowId, runId);
  }

  async getSchedulerStatus() {
    const jobs = await this.scheduler.getScheduledJobs();
    return {
      status: "active",
      scheduled_workflows: jobs.length,
      jobs,
    };
  }
}
