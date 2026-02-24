import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { WorkflowEngine } from "./workflowEngine";
import { BacktestExecutor } from "../nodes/executors/BacktestExecutor";
import { IndicatorStateManager } from "./indicatorStateManager";
import { getRedisCache } from "../config/redis";

export interface BarEvent {
  bar: any;
  symbol: string;
  interval: string;
  barIndex: number;
}

export class BacktestRunner {
  private readonly engine: WorkflowEngine;
  private running = false;
  private readonly abortController: AbortController;
  private barsProcessed = 0;
  private readonly runId: string;

  constructor(
    private readonly backtestId: string,
    workflowId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    private readonly entryNodeIds: string[],
    private readonly backtestInitResult: Record<string, any>,
    private readonly bars: BarEvent[],
    runId: string,
    stateManager?: IndicatorStateManager,
  ) {
    this.abortController = new AbortController();
    this.runId = runId;
    this.engine = new WorkflowEngine(
      this.runId,
      workflowId,
      userId,
      nodes,
      edges,
      "best-effort",
      this.abortController.signal,
    );

    if (stateManager) {
      this.engine.setIndicatorStateManager(stateManager);
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const totalBars = this.bars.length;

    for (let i = 0; i < totalBars; i++) {
      if (!this.running || this.abortController.signal.aborted) break;

      this.engine.resetLight(this.runId, this.abortController.signal);
      this.engine.preloadResults(this.backtestInitResult);

      try {
        await this.engine.executeFromEntries(
          { data: this.bars[i] },
          this.entryNodeIds,
        );
      } catch (error) {
        console.error("[BacktestRunner] Error processing bar:", error);
      }

      this.barsProcessed = i + 1;

      if (this.barsProcessed % 1000 === 0) {
        await this.reportProgress(totalBars);
      }
    }

    await this.finalize();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController.abort();
  }

  private async reportProgress(totalBars: number): Promise<void> {
    const percent = totalBars > 0
      ? Math.round((this.barsProcessed / totalBars) * 100)
      : 100;

    const redis = getRedisCache();
    await redis.set(
      `backtest:progress:${this.backtestId}`,
      JSON.stringify({
        backtestId: this.backtestId,
        barsProcessed: this.barsProcessed,
        totalBars,
        percent,
        updatedAt: new Date().toISOString(),
      }),
      "EX",
      3600,
    );
  }

  private async finalize(): Promise<void> {
    this.running = false;
    await this.reportProgress(this.bars.length);

    try {
      const backtestExecutor = new BacktestExecutor();
      await backtestExecutor.finalizeBacktestById(this.backtestId);
    } catch (error) {
      console.error(
        `[BacktestRunner] Finalization failed for ${this.backtestId}:`,
        error,
      );
    }

    const redis = getRedisCache();
    await redis.del(`backtest:progress:${this.backtestId}`);
  }
}
