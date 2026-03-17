import { getRedisCache } from "../config/redis";
import { BacktestExecutor } from "../nodes/executors/BacktestExecutor";
import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { IndicatorStateManager } from "./indicatorStateManager";
import { DataContextManager } from "./DataContext";
import { WorkflowEngine } from "./workflowEngine";
import { compilePlan, runBar, CompiledPlan } from "./compiledPlan";
import { resolveCategory } from "./compiledPlan/adapters";
import { getNodeExecutor } from "../nodes/registry";

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
  private compiledPlan: CompiledPlan | null = null;

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

    // Ensure node timings are reset for each new backtest session.
    this.engine.clearNodeTiming();

    // Pin init results once — they survive across bar resets
    this.engine.pinResults(this.backtestInitResult);

    // ── Attempt compiled plan compilation ───────────────────────────
    this.tryCompilePlan();
  }

  /**
   * Attempt to compile the workflow into a flat instruction plan.
   * If successful, runAll/step will bypass the dynamic engine entirely.
   */
  private tryCompilePlan(): void {
    const mode = process.env.BACKTEST_EXECUTION_MODE ?? "auto";

    if (mode === "engine") {
      console.log("[BacktestSession] Forced engine mode via BACKTEST_EXECUTION_MODE");
      this.compiledPlan = null;
      return;
    }

    try {
      const compiledParams = this.engine.getCompiledParams();
      this.logCompileEligibilitySnapshot(compiledParams);

      const dataContext = DataContextManager.getInstance().getContext({
        runId: this.runId,
        workflowId: this.workflowId,
        userId: this.userId,
      });

      this.compiledPlan = compilePlan(
        this.engine.getGraph(),
        this.engine.getNodeExecutorMap(),
        this.entryNodeIds,
        compiledParams,
        this.backtestInitResult,
        {
          runId: this.runId,
          workflowId: this.workflowId,
          userId: this.userId,
          nodes: this.nodes,
          edges: this.edges,
          dataContext,
          indicatorStateManager: this.stateManager ?? this.engine.getIndicatorStateManager(),
          abortSignal: this.abortController.signal,
          storeGetState: (nodeId: string, key: string) => this.engine.getNodeState(nodeId, key),
          storeSetState: (nodeId: string, key: string, value: any) =>
            this.engine.setNodeState(nodeId, key, value),
        },
      );

      if (this.compiledPlan) {
        console.log(
          `[BacktestSession] ✅ Using compiled plan VM (${this.compiledPlan.instructions.length} instructions)`,
        );
      } else if (mode === "compiled") {
        console.error(
          "[BacktestSession] ❌ BACKTEST_EXECUTION_MODE=compiled but plan compilation failed — falling back to engine",
        );
      } else {
        console.log("[BacktestSession] Compiled plan not eligible, using engine fallback");
      }
    } catch (err) {
      console.warn(`[BacktestSession] Compiled plan compilation failed, using engine fallback:`, err);
      this.compiledPlan = null;
    }
  }

  private logCompileEligibilitySnapshot(compiledParams: Map<string, any>): void {
    const categories = new Set<string>();

    for (const node of this.nodes) {
      const category = resolveCategory(node);
      const executor = getNodeExecutor(category);
      const cp = compiledParams.get(node.id);

      if (!executor) {
        console.warn(
          `[BacktestSession] [CompiledPlan] Missing executor for node ${node.id} (${node.name}) in category ${category}`,
        );
      } else if (!executor.syncCapable) {
        console.warn(
          `[BacktestSession] [CompiledPlan] Node ${node.id} (${node.name}) in category ${category} is not syncCapable`,
        );
      }

      if (cp?.fallbackKeys?.length) {
        console.warn(
          `[BacktestSession] [CompiledPlan] Node ${node.id} (${node.name}) has fallback templates: ${cp.fallbackKeys.join(", ")}`,
        );
      }
      categories.add(category || "unknown");
    }

    console.log(
      `[BacktestSession] [CompiledPlan] Eligibility snapshot: nodes=${this.nodes.length}, edges=${this.edges.length}, entries=${this.entryNodeIds.length}, categories=[${Array.from(categories).join(", ")}]`,
    );
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

      try {
        if (this.compiledPlan) {
          // ── Compiled plan path ──────────────────────────────────
          runBar(this.compiledPlan, { data: currentEvent });
        } else if (this.currentIndex === 0) {
          // ── First bar: async engine (may need await for init) ───
          this.engine.resetForNextBar();
          await this.engine.executeFromEntries(
            { data: currentEvent },
            this.entryNodeIds,
          );
        } else {
          // ── Subsequent bars: sync engine ────────────────────────
          this.engine.resetForNextBar();
          await this.engine.executeFromEntries(
            { data: currentEvent },
            this.entryNodeIds,
          );
        }
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

    if (this.stepping) {
      throw new Error("Step already in progress");
    }

    this.stepping = true;
    try {
      const signal = this.abortController.signal;

      if (this.compiledPlan) {
        // ═══════════════════════════════════════════════════════════════
        // COMPILED PLAN PATH — no engine, no queue, no routing
        // ═══════════════════════════════════════════════════════════════
        while (
          this.currentIndex < this.bars.length &&
          !signal.aborted &&
          this.status !== "finished"
        ) {
          this.status = "running";
          const chunkEnd = Math.min(this.currentIndex + 500, this.bars.length);

          while (this.currentIndex < chunkEnd && !signal.aborted) {
            const currentEvent = this.bars[this.currentIndex];
            try {
              runBar(this.compiledPlan, { data: currentEvent });
            } catch (error) {
              console.error("[BacktestSession] Compiled plan error on bar:", error);
            }
            this.currentIndex += 1;
          }

          this.barsProcessed = this.currentIndex;
          await this.reportProgress();

          if (this.currentIndex >= this.bars.length) {
            this.status = "finished";
            break;
          }

          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      } else {
        // ═══════════════════════════════════════════════════════════════
        // DYNAMIC ENGINE PATH — existing queue/routing engine
        // ═══════════════════════════════════════════════════════════════
        while (
          this.currentIndex < this.bars.length &&
          !signal.aborted &&
          this.status !== "finished"
        ) {
          this.status = "running";
          const chunkEnd = Math.min(this.currentIndex + 500, this.bars.length);

          while (this.currentIndex < chunkEnd && !signal.aborted) {
            const currentEvent = this.bars[this.currentIndex];

            this.engine.resetForNextBar();

            try {
              if (this.currentIndex === 0) {
                await this.engine.executeFromEntries(
                  { data: currentEvent },
                  this.entryNodeIds,
                );
              } else {
                await this.engine.executeFromEntries(
                  { data: currentEvent },
                  this.entryNodeIds,
                );
              }
            } catch (error) {
              console.error("[BacktestSession] Error processing bar:", error);
            }

            this.currentIndex += 1;
          }

          this.barsProcessed = this.currentIndex;
          await this.reportProgress();

          if (this.currentIndex >= this.bars.length) {
            this.status = "finished";
            break;
          }

          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    } finally {
      this.stepping = false;
    }

    if (this.status === "finished") {
      await this.finalize();
      const timing = this.engine.getNodeTiming();
      if (this.compiledPlan && this.compiledPlan.timingSampleRate > 0) {
        const sampled: Record<string, { totalMs: number; count: number; avgMs: number }> = {};
        for (let i = 0; i < this.compiledPlan.instructions.length; i++) {
          const instr = this.compiledPlan.instructions[i];
          const count = this.compiledPlan.instructionTimingCount[i];
          if (!count) continue;
          const totalMs = this.compiledPlan.instructionTimingMs[i];
          sampled[instr.node.id] = {
            totalMs: +totalMs.toFixed(3),
            count,
            avgMs: +(totalMs / count).toFixed(3),
          };
        }
        console.log(
          `[BacktestSession] Compiled sampled node timing (sampleRate=${this.compiledPlan.timingSampleRate}, sampledBars=${Math.floor(this.compiledPlan.barCount / this.compiledPlan.timingSampleRate)}):`,
          sampled,
        );
      }
      console.log(
        `[BacktestSession] runAll completed for ${this.backtestId}${this.compiledPlan ? " (compiled plan)" : " (dynamic engine)"}`,
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
    DataContextManager.getInstance().destroyContext(this.runId);
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
