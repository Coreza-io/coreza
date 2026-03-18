import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { bullMqJobQueue as jobQueue } from "../infra/jobQueue/jobQueueManager";

export class BacktestLifecycleAdapter {
  async startBacktest(
    runId: string,
    workflowId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
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
