import { bullMqJobQueue as jobQueue } from "../infra/jobQueue/jobQueueManager";
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
    const workflow = (await this.workflowRepo.getOwnedWorkflow(
      userId,
      workflowId,
    )) as any;

    const run = await this.runRepo.createRun(
      workflowId,
      userId,
      workflow.nodes,
      workflow.edges,
    );

    const runId = (run as any).id;

    await jobQueue.addWorkflowExecution({
      runId,
      workflowId,
      userId,
      nodes: workflow.nodes,
      edges: workflow.edges,
      trigger: "manual",
      executionMode: "manual",
      initialInput: inputData,
    });

    return {
      run_id: runId,
      status: "queued",
      message: "Workflow execution queued",
    };
  }
}
