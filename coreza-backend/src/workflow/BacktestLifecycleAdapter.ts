import { WorkflowNode } from "../nodes/types";
import { bullMqJobQueue as jobQueue } from "../services/jobQueueManager";

export class BacktestLifecycleAdapter {
  async startBacktest(
    runId: string,
    workflowId: string,
    userId: string,
    nodes: any[],
    edges: any[],
    triggerNode: WorkflowNode,
  ): Promise<void> {
    await jobQueue.startBacktest(
      runId,
      workflowId,
      userId,
      nodes,
      edges,
      triggerNode,
    );
  }
}
