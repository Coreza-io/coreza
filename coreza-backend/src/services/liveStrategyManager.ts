import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { LiveStrategyRunner } from "./LiveStrategyRunner";

export class LiveStrategyManager {
  private static instance: LiveStrategyManager;
  private readonly runners = new Map<string, LiveStrategyRunner>();

  static getInstance(): LiveStrategyManager {
    if (!LiveStrategyManager.instance) {
      LiveStrategyManager.instance = new LiveStrategyManager();
    }
    return LiveStrategyManager.instance;
  }

  async startStrategy(
    workflowId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
  ): Promise<void> {
    if (this.runners.has(workflowId)) return;

    const runner = new LiveStrategyRunner(workflowId, userId, nodes, edges);
    this.runners.set(workflowId, runner);

    runner.start().catch((error) => {
      console.error(`[LiveStrategyManager] Strategy ${workflowId} crashed:`, error);
      this.runners.delete(workflowId);
    });
  }

  async stopStrategy(workflowId: string): Promise<void> {
    const runner = this.runners.get(workflowId);
    if (!runner) return;

    await runner.stop();
    this.runners.delete(workflowId);
  }

  isRunning(workflowId: string): boolean {
    return this.runners.has(workflowId);
  }

  async stopAll(): Promise<void> {
    for (const [workflowId, runner] of this.runners.entries()) {
      await runner.stop();
      this.runners.delete(workflowId);
    }
  }
}
