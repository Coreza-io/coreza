import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { BacktestRunner } from "./BacktestRunner";

export class BacktestRunnerManager {
  private static instance: BacktestRunnerManager;
  private readonly runners = new Map<string, BacktestRunner>();

  static getInstance(): BacktestRunnerManager {
    if (!BacktestRunnerManager.instance) {
      BacktestRunnerManager.instance = new BacktestRunnerManager();
    }
    return BacktestRunnerManager.instance;
  }

  async startBacktest(
    backtestId: string,
    workflowId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    entryNodeIds: string[],
    backtestInitResult: Record<string, any>,
    totalBars: number,
  ): Promise<void> {
    if (this.runners.has(backtestId)) return;

    const runner = new BacktestRunner(
      backtestId,
      workflowId,
      userId,
      nodes,
      edges,
      entryNodeIds,
      backtestInitResult,
      totalBars,
    );
    this.runners.set(backtestId, runner);

    runner
      .start()
      .catch((error) => {
        console.error(`[BacktestRunnerManager] Backtest ${backtestId} crashed:`, error);
      })
      .finally(() => {
        this.runners.delete(backtestId);
      });
  }

  async stopBacktest(backtestId: string): Promise<void> {
    const runner = this.runners.get(backtestId);
    if (!runner) return;

    await runner.stop();
    this.runners.delete(backtestId);
  }

  isRunning(backtestId: string): boolean {
    return this.runners.has(backtestId);
  }

  async stopAll(): Promise<void> {
    for (const [backtestId, runner] of this.runners.entries()) {
      await runner.stop();
      this.runners.delete(backtestId);
    }
  }
}
