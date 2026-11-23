import { WorkflowEdge, WorkflowNode, type NodeResult } from "../nodes/types";
import { bullMqJobQueue as jobQueue } from "../infra/jobQueue/jobQueueManager";

export class BacktestLifecycleAdapter {
  private static readonly active = new Map<string, { controller: AbortController; execution: Promise<NodeResult> }>();

  cancelRun(runId: string): Promise<void> | undefined {
    const run = BacktestLifecycleAdapter.active.get(runId);
    if (!run) return;
    run.controller.abort();
    return run.execution.then(() => {}, () => {});
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
    const execution = jobQueue.startBacktest(runId, workflowId, userId, nodes, edges, triggerNode, controller.signal);
    BacktestLifecycleAdapter.active.set(runId, { controller, execution });
    try {
      return await execution;
    } finally {
      BacktestLifecycleAdapter.active.delete(runId);
    }
  }
}
