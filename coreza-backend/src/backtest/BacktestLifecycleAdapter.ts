import { WorkflowEdge, WorkflowNode, type NodeResult } from "../nodes/types";
import { bullMqJobQueue as jobQueue } from "../infra/jobQueue/jobQueueManager";
import { runWithBacktestLease, signalBacktestCancellation } from "./BacktestRunControl";

export class BacktestLifecycleAdapter {
  cancelRun(runId: string): void {
    signalBacktestCancellation(runId);
  }

  async startBacktest(
    runId: string,
    workflowId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    triggerNode: WorkflowNode,
  ): Promise<NodeResult> {
    return runWithBacktestLease(runId, signal =>
      jobQueue.startBacktest(runId, workflowId, userId, nodes, edges, triggerNode, signal));
  }
}
