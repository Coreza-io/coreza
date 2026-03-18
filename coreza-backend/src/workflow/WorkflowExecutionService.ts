import { bullMqJobQueue as jobQueue } from "../services/jobQueueManager";
import { WorkflowRepository } from "./WorkflowRepository";
import { WorkflowRunRepository } from "./WorkflowRunRepository";

export class WorkflowExecutionService {
  constructor(
    private workflowRepo: WorkflowRepository,
    private runRepo: WorkflowRunRepository,
  ) {}

  async executeManual(
    userId: string,
    workflowId: string,
    inputData: Record<string, unknown> = {},
  ) {
    const workflow = await this.workflowRepo.getOwnedWorkflow(userId, workflowId);

    const run = await this.runRepo.createRun(
      workflowId,
      userId,
      workflow.nodes,
      workflow.edges,
    );

    await jobQueue.addWorkflowExecution({
      runId: run.id,
      workflowId,
      userId,
      nodes: workflow.nodes,
      edges: workflow.edges,
      trigger: "manual",
      initialInput: inputData,
    });

    return {
      run_id: run.id,
      status: "queued",
      message: "Workflow execution queued",
    };
  }
}
