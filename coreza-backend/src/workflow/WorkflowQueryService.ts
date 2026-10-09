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
    const replacingNested =
      existing.some((c) => c.parentClusterId !== undefined) &&
      (input.nodes !== undefined ||
        input.edges !== undefined ||
        input.node_clusters !== undefined);
    if (nestedCandidate || replacingNested) {
      if (input.cluster_format_version !== 2)
        throw Object.assign(new Error("cluster-writer-upgrade-required"), {
          statusCode: 409,
          isOperational: true,
        });
      if (!(await this.workflowRepo.hierarchyReady()))
        throw Object.assign(new Error("cluster-hierarchy-unavailable"), {
          statusCode: 409,
          isOperational: true,
        });
    }
  }

  async listWorkflows(userId: string) {
    return this.workflowRepo.listByUser(userId);
  }

  async getWorkflow(userId: string, workflowId: string) {
    return this.workflowRepo.getOwnedWorkflow(userId, workflowId);
  }

  async createWorkflow(userId: string, input: CreateWorkflowInput) {
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
    await this.protectHierarchy(input, existing.node_clusters);
    const candidateNodes = input.nodes ?? existing.nodes ?? [];
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
      // A metadata-only update preserves the complete graph. Declare the
      // server's own supported representation when forwarding that snapshot.
      ...(input.nodes === undefined &&
      input.edges === undefined &&
      input.node_clusters === undefined &&
      existing.node_clusters?.some((c) => c.parentClusterId !== undefined)
        ? { cluster_format_version: 2 as const }
        : {}),
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
