import { WorkflowEdge, WorkflowNode, type NodeResult } from "../nodes/types";
import { bullMqJobQueue as jobQueue } from "../infra/jobQueue/jobQueueManager";

export class BacktestLifecycleAdapter {
  private static readonly controllers = new Map<string, AbortController>();

  cancelRun(runId: string): void {
    BacktestLifecycleAdapter.controllers.get(runId)?.abort();
  }

  async startBacktest(
    runId: string,
    workflowId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    triggerNode: WorkflowNode,
  ): Promise<NodeResult> {
    const controller = new AbortController();
    BacktestLifecycleAdapter.controllers.set(runId, controller);
    try {
      return await jobQueue.startBacktest(runId, workflowId, userId, nodes, edges, triggerNode, controller.signal);
    } finally {
      BacktestLifecycleAdapter.controllers.delete(runId);
    }
  }
}
