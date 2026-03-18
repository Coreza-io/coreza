import { SchedulerLifecycleAdapter } from "./SchedulerLifecycleAdapter";
import { CreateWorkflowInput, UpdateWorkflowInput } from "./schemas";
import { WorkflowRepository } from "./WorkflowRepository";
import { WorkflowRunRepository } from "./WorkflowRunRepository";

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
    return this.workflowRepo.create(userId, input);
  }

  async updateWorkflow(userId: string, workflowId: string, input: UpdateWorkflowInput) {
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
