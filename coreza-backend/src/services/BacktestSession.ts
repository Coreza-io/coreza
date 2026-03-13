import { getRedisCache } from "../config/redis";
import { BacktestExecutor } from "../nodes/executors/BacktestExecutor";
import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { IndicatorStateManager } from "./indicatorStateManager";
import { WorkflowEngine } from "./workflowEngine";

export interface BarEvent {
  bar: any;
  symbol: string;
  interval: string;
  barIndex: number;
}

export type BacktestSessionStatus = "ready" | "running" | "finished";

export class BacktestSession {
  public currentIndex = 0;
  public status: BacktestSessionStatus = "ready";

  private readonly engine: WorkflowEngine;
  private readonly stateManager?: IndicatorStateManager;
  private readonly abortController: AbortController;
  private barsProcessed = 0;
  private stepping = false;

  constructor(
    public readonly backtestId: string,
    public readonly workflowId: string,
    public readonly nodeId: string,
    private readonly userId: string,
    private readonly nodes: WorkflowNode[],
    private readonly edges: WorkflowEdge[],
    private readonly entryNodeIds: string[],
    private readonly backtestInitResult: Record<string, any>,
    private readonly bars: BarEvent[],
    private readonly runId: string,
    stateManager?: IndicatorStateManager,
  ) {
    this.abortController = new AbortController();
    this.stateManager = stateManager;
    this.engine = new WorkflowEngine(
      this.runId,
      this.workflowId,
      this.userId,
      this.nodes,
      this.edges,
      "best-effort",
      this.abortController.signal,
    );

    if (stateManager) {
      this.engine.setIndicatorStateManager(stateManager);
    }

    // Pin init results once — they survive across bar resets
    this.engine.pinResults(this.backtestInitResult);
  }

  get totalBars(): number {
    return this.bars.length;
  }

  private normalizeBarPayload(event: BarEvent, isLast: boolean) {
    const bar = event.bar;
    return {
      BarSeries: [
        {
          symbol: event.symbol,
          interval: event.interval,
          bars: [bar],
        },
      ],
      barIndex: event.barIndex,
      isLast,
      total_bars: this.totalBars,
    };
  }

  async step(): Promise<Record<string, any>> {
    if (this.stepping) {
      throw new Error("Step already in progress");
    }

    this.stepping = true;
    try {
      if (this.status === "finished" || this.currentIndex >= this.bars.length) {
        this.status = "finished";
        return { isLast: true, total_bars: this.totalBars };
      }

      this.status = "running";
      const currentEvent = this.bars[this.currentIndex];

      // Ultra-lightweight reset — reuses store, queue, and pinned results
      this.engine.resetForNextBar();

      try {
        await this.engine.executeFromEntries(
          { data: currentEvent },
          this.entryNodeIds,
        );
      } catch (error) {
        console.error("[BacktestSession] Error processing bar:", error);
      }

      this.currentIndex += 1;
      this.barsProcessed = this.currentIndex;

      if (this.barsProcessed % 1000 === 0) {
        await this.reportProgress();
      }

      const isLast = this.currentIndex >= this.bars.length;
      if (isLast) {
        this.status = "finished";
        await this.reportProgress();
      }

      return this.normalizeBarPayload(currentEvent, isLast);
    } finally {
      this.stepping = false;
    }
  }

  async nextBar(): Promise<Record<string, any>> {
    if (this.stepping) {
      throw new Error("Step already in progress");
    }

    this.stepping = true;
    try {
      if (this.status === "finished" || this.currentIndex >= this.bars.length) {
        this.status = "finished";
        return { isLast: true, total_bars: this.totalBars };
      }

      this.status = "running";
      const currentEvent = this.bars[this.currentIndex];

      this.currentIndex += 1;
      this.barsProcessed = this.currentIndex;

      if (this.barsProcessed % 1000 === 0) {
        await this.reportProgress();
      }

      const isLast = this.currentIndex >= this.bars.length;
      if (isLast) {
        this.status = "finished";
        await this.reportProgress();
      }

      return this.normalizeBarPayload(currentEvent, isLast);
    } finally {
      this.stepping = false;
    }
  }

  async runAll(): Promise<void> {
    if (this.status === "finished") {
      return;
    }

    while (
      this.status !== "finished" &&
      !this.abortController.signal.aborted &&
      this.currentIndex < this.bars.length
    ) {
      await this.step();

      if (this.currentIndex % 500 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    if (this.status === "finished") {
      await this.finalize();
      const timing = this.engine.getNodeTiming();
      console.log(
        `[BacktestSession] runAll node timing for ${this.backtestId}:`,
        timing,
      );
    }
  }

  async reset(): Promise<void> {
    this.currentIndex = 0;
    this.barsProcessed = 0;
    this.status = "ready";

    BacktestExecutor.resetBacktestState(this.backtestId);
    this.engine.reset(this.runId, this.abortController.signal);
    this.stateManager?.clearL1Cache();

    await this.reportProgress();
  }

  cleanup(): void {
    this.abortController.abort();
    BacktestExecutor.cleanupBacktestResources(this.backtestId);
  }

  private async reportProgress(): Promise<void> {
    const percent = this.totalBars > 0
      ? Math.round((this.barsProcessed / this.totalBars) * 100)
      : 100;

    const redis = getRedisCache();
    await redis.set(
      `backtest:progress:${this.backtestId}`,
      JSON.stringify({
        backtestId: this.backtestId,
        barsProcessed: this.barsProcessed,
        totalBars: this.totalBars,
        percent,
        updatedAt: new Date().toISOString(),
      }),
      "EX",
      3600,
    );
  }

  private async finalize(): Promise<void> {
    try {
      const backtestExecutor = new BacktestExecutor();
      await backtestExecutor.finalizeBacktestById(this.backtestId);
    } catch (error) {
      console.error(
        `[BacktestSession] Finalization failed for ${this.backtestId}:`,
        error,
      );
    }

    const timing = this.engine.getNodeTiming();
    const redis = getRedisCache();
    await redis.set(
      `backtest:timing:${this.backtestId}`,
      JSON.stringify(timing),
      "EX",
      3600,
    );
    console.log(`[BacktestSession] Node timing for ${this.backtestId}:`, timing);
    await redis.del(`backtest:progress:${this.backtestId}`);
  }
}
