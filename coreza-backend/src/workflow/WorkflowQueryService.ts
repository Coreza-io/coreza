import { SchedulerLifecycleAdapter } from "./SchedulerLifecycleAdapter";
import { CreateWorkflowInput, UpdateWorkflowInput } from "./schemas";
import { WorkflowRepository } from "./WorkflowRepository";
import { WorkflowRunRepository } from "./WorkflowRunRepository";
import { validateNodeClusterDocument } from "./validateNodeClusters";

export class WorkflowQueryService {
  constructor(
    private workflowRepo: WorkflowRepository,
    private runRepo: WorkflowRunRepository,
    private scheduler: SchedulerLifecycleAdapter,
  ) {}

  async listWorkflows(userId: string) {
    return this.workflowRepo.listByUser(userId);
  }

  async createWorkflow(userId: string, input: CreateWorkflowInput) {
    validateNodeClusterDocument({ nodes: input.nodes, edges: input.edges, node_clusters: input.node_clusters });
    return this.workflowRepo.create(userId, input);
  }

  async updateWorkflow(userId: string, workflowId: string, input: UpdateWorkflowInput) {
    const existing = await this.workflowRepo.getOwnedWorkflow(userId, workflowId, "nodes,edges,node_clusters") as {
      nodes?: Array<{ id?: unknown }>;
      edges?: Array<{ id?: unknown; source?: unknown; target?: unknown }>;
      node_clusters?: CreateWorkflowInput["node_clusters"];
    };
    validateNodeClusterDocument({
      nodes: input.nodes ?? existing.nodes ?? [],
      edges: input.edges ?? existing.edges ?? [],
      node_clusters: input.node_clusters ?? existing.node_clusters ?? [],
    });
    return this.workflowRepo.update(userId, workflowId, input);
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
