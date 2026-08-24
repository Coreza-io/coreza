import { getRedisCache } from "../../config/redis";
import { BacktestExecutor } from "../BacktestExecutor";
import { WorkflowEdge, WorkflowNode } from "../../nodes/types";
import { IndicatorStateManager } from "../../engine/indicatorStateManager";
import { DataContextManager } from "../../engine/DataContext";
import { WorkflowPlan } from "../../engine/workflowPlan";
import { WorkflowRun } from "../../engine/workflowRun";
import { compilePlan, runBar, CompiledPlan } from "../compiled";
import { resolveCategory } from "../compiled/adapters";
import { getNodeExecutor } from "../../nodes/registry";
import { RedisKeys } from "../../infra/redisKeys";
import { createWorkflowLifecycleService } from "../../workflow/lifecycleServiceInstance";
import { toMarketBarEnvelope } from "../simBroker/marketEnvelope";
import { seedRollingWindows } from "../rollingWindowSeed";
import type { RollingWindowSeed } from "../rollingWindowSeed";
import { buildIndicatorKey } from "../../engine";
import type { DiscoveredWarmupNode } from "../../nodes/executors/InitializeIndicatorsExecutor";
import type { HistoricalBar } from "../../marketData/HistoricalDataService";
import type { BacktestPhase, WarmupMode } from "../warmup/types";
import { commitConsolidatorEmissions, scanConsolidators } from "../../engine/consolidation/consolidatorScan";
import { parseTimeframe } from "../../utils/timeframe";

export interface IndicatorWarmupSeed {
  interval: string;
  symbols: string[];
  warmupBarsBySymbol: Map<string, HistoricalBar[]>;
  indicators: DiscoveredWarmupNode[];
}

export type IndicatorInitialization = Omit<
  IndicatorWarmupSeed,
  "warmupBarsBySymbol"
>;

export interface BarEvent {
  bar: any;
  symbol: string;
  interval: string;
  barIndex: number;
}

export interface MultiBarEvent {
  timestamp: string;
  barIndex: number;
  interval: string;
  symbols: string[];
  bars: Record<string, any>;
}

export interface SymbolExecutionContext {
  isWarmingUp: boolean;
  multiBarContext: {
    timestamp: string;
    interval: string;
    symbols: string[];
    currentSymbol: string;
    bars: Record<string, any>;
    getBar: (symbol: string) => any;
  };
}

export type BacktestSessionStatus = "ready" | "running" | "finished";

export class BacktestSession {
  public currentIndex = 0;
  public status: BacktestSessionStatus = "ready";
  public phase: BacktestPhase = "initializing";

  private readonly plan: WorkflowPlan;
  private run: WorkflowRun;
  private readonly stateManager?: IndicatorStateManager;
  private readonly abortController: AbortController;
  private barsProcessed = 0;
  private currentSymbolIndex = 0;
  private stepping = false;
  private compiledPlan: CompiledPlan | null = null;
  private finalClockScanned = false;
  private readonly reusableBarInput: { data: any } = { data: null };
  private currentMultiBarBars: Record<string, any> = Object.create(null);
  private readonly reusableSymbolExecutionContext: SymbolExecutionContext = {
    isWarmingUp: false,
    multiBarContext: {
      timestamp: "",
      interval: "",
      symbols: [],
      currentSymbol: "",
      bars: this.currentMultiBarBars,
      getBar: (symbol: string) => this.currentMultiBarBars[symbol],
    },
  };
  private perf = {
    totalStart: 0,
    mode: "ENGINE" as "COMPILED" | "ENGINE",
    simBrokerOnBarMs: 0,
    resetMs: 0,
    executeLoopMs: 0,
    contextBuildMs: 0,
    equitySnapshotMs: 0,
    buildResultMs: 0,
    storeClearMs: 0,
    progressReportMs: 0,
    progressReportCount: 0,
    yieldMs: 0,
    yieldCount: 0,
    finalizeMs: 0,
    timingPersistMs: 0,
    progressCleanupMs: 0,
    symbolEventBuildMs: 0,
    snapshotTimestampMs: 0,
    runnerBookkeepingMs: 0,
    symbolExecutions: 0,
    warmup: { events: 0, totalMs: 0 },
  };

  constructor(
    public readonly backtestId: string,
    public readonly workflowId: string,
    public readonly nodeId: string,
    private readonly userId: string,
    private readonly nodes: WorkflowNode[],
    private readonly edges: WorkflowEdge[],
    private readonly entryNodeIds: string[],
    private readonly backtestInitResult: Record<string, any>,
    private readonly bars: MultiBarEvent[],
    private readonly executionId: string,
    stateManager?: IndicatorStateManager,
    private readonly rollingWindowSeed?: RollingWindowSeed,
    private readonly indicatorWarmupSeed?: IndicatorWarmupSeed,
    private readonly warmupMode: WarmupMode = "seed",
    private readonly warmupEvents: MultiBarEvent[] = [],
    private readonly indicatorInitialization?: IndicatorInitialization,
    private readonly endExclusiveClock?: string,
  ) {
    this.abortController = new AbortController();
    this.stateManager = stateManager;
    this.plan = WorkflowPlan.compile(this.nodes, this.edges, "backtest");
    this.run = this.plan.createRun({
      executionId: this.executionId,
      workflowId: this.workflowId,
      userId: this.userId,
      mode: "best-effort",
      abortSignal: this.abortController.signal,
      executionMode: "backtest",
    });

    if (stateManager) {
      this.run.setIndicatorStateManager(stateManager);
    }

    // Ensure node timings are reset for each new backtest session.
    this.run.clearNodeTiming();

    // Pin init results once — they survive across bar resets
    this.run.pinResults(this.backtestInitResult);

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
      console.log(
        "[BacktestSession] Forced engine mode via BACKTEST_EXECUTION_MODE",
      );
      this.compiledPlan = null;
      return;
    }

    try {
      const compiledParams = this.run.getCompiledParams();
      this.logCompileEligibilitySnapshot(compiledParams);

      const dataContext = DataContextManager.getInstance().getContext({
        executionId: this.executionId,
        workflowId: this.workflowId,
        userId: this.userId,
      });

      this.compiledPlan = compilePlan(
        this.plan.graph,
        this.plan.nodeExecutorMap,
        this.entryNodeIds,
        compiledParams,
        this.backtestInitResult,
        {
          runId: this.executionId,
          workflowId: this.workflowId,
          userId: this.userId,
          nodes: this.nodes,
          edges: this.edges,
          dataContext,
          indicatorStateManager:
            this.stateManager ?? this.run.getIndicatorStateManager(),
          abortSignal: this.abortController.signal,
          storeGetState: (nodeId: string, key: string) =>
            this.run.getNodeState(nodeId, key),
          storeSetState: (nodeId: string, key: string, value: any) =>
            this.run.setNodeState(nodeId, key, value),
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
        console.log(
          "[BacktestSession] Compiled plan not eligible, using engine fallback",
        );
      }
    } catch (err) {
      console.warn(
        `[BacktestSession] Compiled plan compilation failed, using engine fallback:`,
        err,
      );
      this.compiledPlan = null;
    }
  }

  private logCompileEligibilitySnapshot(
    compiledParams: Map<string, any>,
  ): void {
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

  private normalizeBarPayload(event: MultiBarEvent, isLast: boolean) {
    return {
      BarSeries: event.symbols
        .filter((symbol) => event.bars[symbol])
        .map((symbol) => ({
          symbol,
          interval: event.interval,
          bars: [event.bars[symbol]],
        })),
      barIndex: event.barIndex,
      isLast,
      total_bars: this.totalBars,
      timestamp: event.timestamp,
    };
  }

  private normalizeManualBarPayload(
    event: MultiBarEvent,
    symbol: string,
    symbolIndex: number,
    isLast: boolean,
  ) {
    const bar = event.bars[symbol];

    return {
      BarSeries: bar
        ? [
            {
              symbol,
              interval: event.interval,
              bars: [bar],
            },
          ]
        : [],
      barIndex: event.barIndex,
      isLast,
      total_bars: this.totalBars,
      currentSymbol: symbol,
      symbolIndex,
      totalSymbols: event.symbols.length,
      symbols: event.symbols,
      timestamp: event.timestamp,
    };
  }

  private buildSymbolExecutionContext(
    event: MultiBarEvent,
    currentSymbol: string,
  ): SymbolExecutionContext {
    const multiBarContext = this.reusableSymbolExecutionContext.multiBarContext;
    this.reusableSymbolExecutionContext.isWarmingUp =
      this.phase === "warming_up";
    this.currentMultiBarBars = event.bars;
    multiBarContext.timestamp = event.timestamp;
    multiBarContext.interval = event.interval;
    multiBarContext.symbols = event.symbols;
    multiBarContext.currentSymbol = currentSymbol;
    multiBarContext.bars = event.bars;
    return this.reusableSymbolExecutionContext;
  }

  async initialize(): Promise<void> {
    if (this.phase !== "initializing") return;
    if (this.warmupMode === "workflow_replay" && this.indicatorWarmupSeed) {
      throw new Error(
        "Warm-up replay and direct indicator seeding are mutually exclusive",
      );
    }
    if (this.warmupMode === "workflow_replay") {
      await this.initializeIndicatorStates();
    }
    if (this.warmupMode === "workflow_replay" && this.warmupEvents.length > 0) {
      this.phase = "warming_up";
      const broker = BacktestExecutor.getSimBrokerForBacktest(this.backtestId);
      broker?.setWarmingUp(true);
      const startedAt = performance.now();
      // Snapshot only the accumulator fields — `mode`/`totalStart` must keep
      // whatever the strategy run sets, and `warmup` is written below.
      const { mode, totalStart, warmup, ...strategyAccumulators } = this.perf;
      try {
        for (const event of this.warmupEvents)
          await this.executeTimestampAsync(event);
      } finally {
        const totalMs = performance.now() - startedAt;
        Object.assign(this.perf, strategyAccumulators);
        this.perf.warmup = {
          events: this.warmupEvents.length,
          totalMs,
        };
        broker?.setWarmingUp(false);
      }
    }
    if (this.warmupMode === "workflow_replay") {
      this.completeIndicatorWarmup();
    }
    this.phase = "ready";
    this.status = "ready";
    this.currentIndex = 0;
    if (this.warmupMode === "workflow_replay") {
      this.run.clearNodeTiming();
      this.tryCompilePlan();
    }
  }

  private async initializeIndicatorStates(): Promise<void> {
    if (!this.stateManager || !this.indicatorInitialization) return;
    const { interval, symbols, indicators } = this.indicatorInitialization;
    for (const symbol of symbols) {
      for (const indicator of indicators) {
        const { candle_data, ...params } = indicator.params;
        const timeframe = String(params.timeframe || interval);
        await this.stateManager.initialize(
          buildIndicatorKey(
            this.userId,
            this.workflowId,
            this.executionId,
            symbol,
            timeframe,
            indicator.nodeId,
          ),
          indicator.type,
          { ...params, symbol, timeframe },
          true,
        );
      }
    }
  }

  private completeIndicatorWarmup(): void {
    if (!this.stateManager || !this.indicatorInitialization) return;
    const { interval, symbols, indicators } = this.indicatorInitialization;
    for (const symbol of symbols) {
      for (const indicator of indicators) {
        const timeframe = String(indicator.params.timeframe || interval);
        this.stateManager.markWarmupCompleted(
          buildIndicatorKey(
            this.userId,
            this.workflowId,
            this.executionId,
            symbol,
            timeframe,
            indicator.nodeId,
          ),
        );
      }
    }
  }

  private buildSnapshotTimestamp(event: MultiBarEvent): string {
    const t0 = performance.now();
    const snapshotTimestamp =
      event.timestamp ||
      String(
        event.bars[event.symbols[0]]?.timestamp ?? new Date().toISOString(),
      );
    this.perf.snapshotTimestampMs += performance.now() - t0;
    return snapshotTimestamp;
  }

  private async reportProgressTimed(): Promise<void> {
    const t0 = performance.now();
    await this.reportProgress();
    this.perf.progressReportMs += performance.now() - t0;
    this.perf.progressReportCount += 1;
  }

  private async yieldToEventLoop(): Promise<void> {
    const t0 = performance.now();
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.perf.yieldMs += performance.now() - t0;
    this.perf.yieldCount += 1;
  }

  private logRunAllBenchmark(elapsed: number): void {
    const p = this.perf;
    const hotPathTrackedMs =
      p.simBrokerOnBarMs +
      p.resetMs +
      p.executeLoopMs +
      p.contextBuildMs +
      p.equitySnapshotMs +
      p.buildResultMs +
      p.storeClearMs +
      p.symbolEventBuildMs +
      p.snapshotTimestampMs;
    const runnerControlMs =
      p.progressReportMs + p.yieldMs + p.runnerBookkeepingMs;
    const finalizeMs = p.finalizeMs + p.timingPersistMs + p.progressCleanupMs;
    const unknownMs = Math.max(
      0,
      elapsed - hotPathTrackedMs - runnerControlMs - finalizeMs,
    );
    const timing = this.run.getNodeTiming();
    console.log(`[BacktestBenchmark] Mode: ${p.mode}`, {
      totalRuntimeMs: +elapsed.toFixed(1),
      totalBars: this.totalBars,
      barsPerSec: +(this.totalBars / (elapsed / 1000)).toFixed(0),
      symbolsPerSec: +(p.symbolExecutions / (elapsed / 1000)).toFixed(0),
      avgPerBarMs: +(elapsed / this.totalBars).toFixed(4),
      breakdown: {
        hotPathTrackedMs: +hotPathTrackedMs.toFixed(1),
        runnerControlMs: +runnerControlMs.toFixed(1),
        finalizeMs: +finalizeMs.toFixed(1),
        unknownMs: +unknownMs.toFixed(1),
        hotPath: {
          simBrokerOnBarMs: +p.simBrokerOnBarMs.toFixed(1),
          symbolEventBuildMs: +p.symbolEventBuildMs.toFixed(1),
          contextBuildMs: +p.contextBuildMs.toFixed(1),
          executeLoopMs: +p.executeLoopMs.toFixed(1),
          resetMs: +p.resetMs.toFixed(1),
          buildResultMs: +p.buildResultMs.toFixed(1),
          storeClearMs: +p.storeClearMs.toFixed(1),
          snapshotTimestampMs: +p.snapshotTimestampMs.toFixed(1),
          equitySnapshotMs: +p.equitySnapshotMs.toFixed(1),
        },
        runnerControl: {
          progressReportMs: +p.progressReportMs.toFixed(1),
          progressReportCount: p.progressReportCount,
          yieldMs: +p.yieldMs.toFixed(1),
          yieldCount: p.yieldCount,
          runnerBookkeepingMs: +p.runnerBookkeepingMs.toFixed(1),
        },
        finalize: {
          finalizeBacktestMs: +p.finalizeMs.toFixed(1),
          timingPersistMs: +p.timingPersistMs.toFixed(1),
          progressCleanupMs: +p.progressCleanupMs.toFixed(1),
        },
      },
      pctBreakdown: {
        hotPathTracked: `${((hotPathTrackedMs / elapsed) * 100).toFixed(1)}%`,
        runnerControl: `${((runnerControlMs / elapsed) * 100).toFixed(1)}%`,
        finalize: `${((finalizeMs / elapsed) * 100).toFixed(1)}%`,
        unknown: `${((unknownMs / elapsed) * 100).toFixed(1)}%`,
      },
      symbolExecutions: p.symbolExecutions,
    });
    if (this.compiledPlan && this.compiledPlan.timingSampleRate > 0) {
      const sampled: Record<
        string,
        { totalMs: number; count: number; avgMs: number }
      > = {};
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
      const vmTimingLabels = [
        "paramResolutionMs",
        "nodeExecutionMs",
        "activationMs",
      ] as const;
      const vmTiming: Record<
        string,
        { totalMs: number; count: number; avgMs: number }
      > = {};
      for (let i = 0; i < vmTimingLabels.length; i++) {
        const count = this.compiledPlan.vmTimingCount[i];
        if (!count) continue;
        const totalMs = this.compiledPlan.vmTimingMs[i];
        vmTiming[vmTimingLabels[i]] = {
          totalMs: +totalMs.toFixed(3),
          count,
          avgMs: +(totalMs / count).toFixed(3),
        };
      }
      console.log(
        `[BacktestSession] Compiled sampled VM timing (sampleRate=${this.compiledPlan.timingSampleRate}):`,
        vmTiming,
      );
    }
    console.log(
      `[BacktestSession] runAll completed for ${this.backtestId}${this.compiledPlan ? " (compiled plan)" : " (dynamic engine)"}`,
      timing,
    );
  }

  private async executeTimestamp(event: MultiBarEvent): Promise<void> {
    const symbols = event.symbols;
    let t0 = performance.now();

    await this.executeConsolidatorClock(event.timestamp);

    for (const symbol of symbols) {
      const bar = event.bars[symbol];
      if (bar) {
        const envelope = toMarketBarEnvelope(symbol, bar, event.timestamp);
        if (envelope) {
          BacktestExecutor.getSimBrokerForBacktest(this.backtestId)?.onBar(
            envelope,
            { warmup: this.phase === "warming_up" },
          );
        }
      }
    }
    this.perf.simBrokerOnBarMs += performance.now() - t0;

    for (const symbol of symbols) {
      const bar = event.bars[symbol];
      if (!bar) {
        continue;
      }

      t0 = performance.now();
      const symbolEvent: BarEvent = {
        bar,
        symbol,
        interval: event.interval,
        barIndex: event.barIndex,
      };
      this.perf.symbolEventBuildMs += performance.now() - t0;
      t0 = performance.now();
      const symbolExecutionContext = this.buildSymbolExecutionContext(
        event,
        symbol,
      );
      if (this.compiledPlan) {
        this.compiledPlan.ctx.multiBarContext =
          symbolExecutionContext.multiBarContext;
        this.compiledPlan.ctx.isWarmingUp = symbolExecutionContext.isWarmingUp;
      } else {
        this.run.setExecutionContextExtras(symbolExecutionContext);
      }
      this.perf.contextBuildMs += performance.now() - t0;

      if (this.compiledPlan) {
        t0 = performance.now();
        this.reusableBarInput.data = symbolEvent;
        await runBar(this.compiledPlan, this.reusableBarInput);
        this.perf.executeLoopMs += performance.now() - t0;
      } else {
        t0 = performance.now();
        this.run.resetForNextBar();
        this.perf.resetMs += performance.now() - t0;
        this.perf.storeClearMs += this.run.lastStoreClearMs;
        t0 = performance.now();
        void this.run
          .executeFromEntries({ data: symbolEvent }, this.entryNodeIds)
          .then(() => {
            this.perf.buildResultMs += this.run.lastBuildResultMs;
          });
        this.perf.executeLoopMs += performance.now() - t0;
      }

      this.perf.symbolExecutions += 1;
    }

    if (this.phase === "warming_up") return;
    const snapshotTimestamp = this.buildSnapshotTimestamp(event);
    t0 = performance.now();
    BacktestExecutor.getSimBrokerForBacktest(
      this.backtestId,
    )?.recordEquitySnapshot(snapshotTimestamp);
    this.perf.equitySnapshotMs += performance.now() - t0;
  }

  private async executeTimestampAsync(event: MultiBarEvent): Promise<void> {
    const symbols = event.symbols;
    let t0 = performance.now();

    await this.executeConsolidatorClock(event.timestamp);

    for (const symbol of symbols) {
      const bar = event.bars[symbol];
      if (bar) {
        const envelope = toMarketBarEnvelope(symbol, bar, event.timestamp);
        if (envelope) {
          BacktestExecutor.getSimBrokerForBacktest(this.backtestId)?.onBar(
            envelope,
            { warmup: this.phase === "warming_up" },
          );
        }
      }
    }
    this.perf.simBrokerOnBarMs += performance.now() - t0;

    for (const symbol of symbols) {
      const bar = event.bars[symbol];
      if (!bar) {
        continue;
      }

      t0 = performance.now();
      const symbolEvent: BarEvent = {
        bar,
        symbol,
        interval: event.interval,
        barIndex: event.barIndex,
      };
      this.perf.symbolEventBuildMs += performance.now() - t0;
      t0 = performance.now();
      const symbolExecutionContext = this.buildSymbolExecutionContext(
        event,
        symbol,
      );
      if (this.compiledPlan) {
        this.compiledPlan.ctx.multiBarContext =
          symbolExecutionContext.multiBarContext;
        this.compiledPlan.ctx.isWarmingUp = symbolExecutionContext.isWarmingUp;
      } else {
        this.run.setExecutionContextExtras(symbolExecutionContext);
      }
      this.perf.contextBuildMs += performance.now() - t0;

      if (this.compiledPlan) {
        t0 = performance.now();
        await runBar(this.compiledPlan, { data: symbolEvent });
        this.perf.executeLoopMs += performance.now() - t0;
      } else {
        t0 = performance.now();
        this.run.resetForNextBar();
        this.perf.resetMs += performance.now() - t0;
        this.perf.storeClearMs += this.run.lastStoreClearMs;
        t0 = performance.now();
        await this.run.executeFromEntries(
          { data: symbolEvent },
          this.entryNodeIds,
        );
        this.perf.executeLoopMs += performance.now() - t0;
        this.perf.buildResultMs += this.run.lastBuildResultMs;
      }

      this.perf.symbolExecutions += 1;
    }

    if (this.phase === "warming_up") return;
    const snapshotTimestamp = this.buildSnapshotTimestamp(event);
    t0 = performance.now();
    BacktestExecutor.getSimBrokerForBacktest(
      this.backtestId,
    )?.recordEquitySnapshot(snapshotTimestamp);
    this.perf.equitySnapshotMs += performance.now() - t0;
  }

  private async executeConsolidatorClock(timestamp: string): Promise<void> {
    if (process.env.ENABLE_CONSOLIDATOR_SCAN !== "true") return;
    const emissions = scanConsolidators(this.run.getDataContext(), timestamp, { commit: false });
    if (emissions.length === 0) return;
    this.run.setExecutionContextExtras({
      isWarmingUp: this.phase === "warming_up",
    });
    await this.run.executeInjectedResults(
      emissions,
      (delivered) => commitConsolidatorEmissions(this.run.getDataContext(), delivered),
    );
  }

  async step(): Promise<Record<string, any>> {
    return this.nextBar();
  }

  private async executeNextTimestamp(
    manual = false,
  ): Promise<Record<string, any>> {
    if (this.stepping) {
      throw new Error("Step already in progress");
    }

    this.stepping = true;
    try {
      if (this.status === "finished" || this.currentIndex >= this.bars.length) {
        this.status = "finished";
        this.phase = "finished";
        return { isLast: true, total_bars: this.totalBars };
      }

      this.status = "running";
      this.phase = "running";
      const currentEvent = this.bars[this.currentIndex];

      try {
        if (manual) {
          const availableSymbols = currentEvent.symbols.filter(
            (symbol) => currentEvent.bars[symbol],
          );

          if (availableSymbols.length === 0) {
            this.currentIndex += 1;
            this.currentSymbolIndex = 0;
            this.barsProcessed = this.currentIndex;

            const isLast = this.currentIndex >= this.bars.length;
            if (isLast) {
              this.status = "finished";
              this.phase = "finished";
              await this.reportProgress();
            }

            return {
              BarSeries: [],
              barIndex: currentEvent.barIndex,
              isLast,
              total_bars: this.totalBars,
              symbolIndex: 0,
              totalSymbols: 0,
              symbols: [],
              timestamp: currentEvent.timestamp,
            };
          }

          const symbolIndex = Math.min(
            this.currentSymbolIndex,
            availableSymbols.length - 1,
          );
          const currentSymbol = availableSymbols[symbolIndex];
          const currentBar = currentEvent.bars[currentSymbol];

          const stepEnvelope = toMarketBarEnvelope(
            currentSymbol,
            currentBar,
            currentEvent.timestamp,
          );
          if (stepEnvelope) {
            BacktestExecutor.getSimBrokerForBacktest(this.backtestId)?.onBar(
              stepEnvelope,
            );
          }

          const nextSymbolIndex = symbolIndex + 1;
          const consumedTimestamp = nextSymbolIndex >= availableSymbols.length;

          if (consumedTimestamp) {
            const snapshotTimestamp =
              currentEvent.timestamp ||
              String(
                currentEvent.bars[currentEvent.symbols[0]]?.timestamp ??
                  new Date().toISOString(),
              );
            BacktestExecutor.getSimBrokerForBacktest(
              this.backtestId,
            )?.recordEquitySnapshot(snapshotTimestamp);
            this.currentIndex += 1;
            this.currentSymbolIndex = 0;
          } else {
            this.currentSymbolIndex = nextSymbolIndex;
          }

          this.barsProcessed = this.currentIndex;
          if (this.barsProcessed > 0 && this.barsProcessed % 1000 === 0) {
            await this.reportProgress();
          }

          const isLast = this.currentIndex >= this.bars.length;
          if (isLast) {
            this.status = "finished";
            this.phase = "finished";
            await this.reportProgress();
          }

          return this.normalizeManualBarPayload(
            currentEvent,
            currentSymbol,
            symbolIndex,
            isLast,
          );
        }

        await this.executeTimestampAsync(currentEvent);
      } catch (error) {
        console.error("[BacktestSession] Error processing bar:", error);
        throw error;
      }

      this.currentIndex += 1;
      this.barsProcessed = this.currentIndex;

      if (this.barsProcessed % 1000 === 0) {
        await this.reportProgress();
      }

      const isLast = this.currentIndex >= this.bars.length;
      if (isLast) {
        this.status = "finished";
        this.phase = "finished";
        await this.reportProgress();
      }

      return this.normalizeBarPayload(currentEvent, isLast);
    } finally {
      this.stepping = false;
    }
  }

  async nextBar(manual = false): Promise<Record<string, any>> {
    return this.executeNextTimestamp(manual);
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
      this.perf = {
        totalStart: performance.now(),
        mode: this.compiledPlan ? "COMPILED" : "ENGINE",
        simBrokerOnBarMs: 0,
        resetMs: 0,
        executeLoopMs: 0,
        contextBuildMs: 0,
        equitySnapshotMs: 0,
        buildResultMs: 0,
        storeClearMs: 0,
        progressReportMs: 0,
        progressReportCount: 0,
        yieldMs: 0,
        yieldCount: 0,
        finalizeMs: 0,
        timingPersistMs: 0,
        progressCleanupMs: 0,
        symbolEventBuildMs: 0,
        snapshotTimestampMs: 0,
        runnerBookkeepingMs: 0,
        symbolExecutions: 0,
        warmup: { ...this.perf.warmup },
      };

      if (this.compiledPlan) {
        // ═══════════════════════════════════════════════════════════════
        // COMPILED PLAN PATH — no engine, no queue, no routing
        // ═══════════════════════════════════════════════════════════════
        let lastProgressTime = performance.now();
        while (this.currentIndex < this.bars.length && !signal.aborted) {
          let t0 = performance.now();
          this.status = "running";
          this.phase = "running";
          const chunkEnd = Math.min(this.currentIndex + 5000, this.bars.length);
          this.perf.runnerBookkeepingMs += performance.now() - t0;

          while (this.currentIndex < chunkEnd && !signal.aborted) {
            const currentEvent = this.bars[this.currentIndex];
            try {
              await this.executeTimestamp(currentEvent);
            } catch (error) {
              console.error(
                "[BacktestSession] Compiled plan error on bar:",
                error,
              );
            }
            t0 = performance.now();
            this.currentIndex += 1;
            this.perf.runnerBookkeepingMs += performance.now() - t0;
          }

          t0 = performance.now();
          this.barsProcessed = this.currentIndex;
          const now = performance.now();
          const shouldReportProgress =
            now - lastProgressTime >= 2000 ||
            this.currentIndex >= this.bars.length;
          this.perf.runnerBookkeepingMs += performance.now() - t0;
          if (shouldReportProgress) {
            await this.reportProgressTimed();
            lastProgressTime = now;
          }

          if (this.currentIndex >= this.bars.length) {
            t0 = performance.now();
            this.status = "finished";
            this.phase = "finished";
            this.perf.runnerBookkeepingMs += performance.now() - t0;
            break;
          }

          await this.yieldToEventLoop();
        }
      } else {
        // ═══════════════════════════════════════════════════════════════
        // DYNAMIC ENGINE PATH — existing queue/routing engine
        // ═══════════════════════════════════════════════════════════════
        let lastProgressTime = performance.now();
        while (this.currentIndex < this.bars.length && !signal.aborted) {
          let t0 = performance.now();
          this.status = "running";
          this.phase = "running";
          const chunkEnd = Math.min(this.currentIndex + 5000, this.bars.length);
          this.perf.runnerBookkeepingMs += performance.now() - t0;

          while (this.currentIndex < chunkEnd && !signal.aborted) {
            const currentEvent = this.bars[this.currentIndex];
            try {
              await this.executeTimestampAsync(currentEvent);
            } catch (error) {
              console.error("[BacktestSession] Error processing bar:", error);
            }

            t0 = performance.now();
            this.currentIndex += 1;
            this.perf.runnerBookkeepingMs += performance.now() - t0;
          }

          t0 = performance.now();
          this.barsProcessed = this.currentIndex;
          const now = performance.now();
          const shouldReportProgress =
            now - lastProgressTime >= 2000 ||
            this.currentIndex >= this.bars.length;
          this.perf.runnerBookkeepingMs += performance.now() - t0;
          if (shouldReportProgress) {
            await this.reportProgressTimed();
            lastProgressTime = now;
          }

          if (this.currentIndex >= this.bars.length) {
            t0 = performance.now();
            this.status = "finished";
            this.phase = "finished";
            this.perf.runnerBookkeepingMs += performance.now() - t0;
            break;
          }

          await this.yieldToEventLoop();
        }
      }
    } finally {
      this.stepping = false;
    }

    if (this.status === "finished") {
      await this.finalize();
      const elapsed = performance.now() - this.perf.totalStart;
      this.logRunAllBenchmark(elapsed);
    }
  }

  async reset(): Promise<void> {
    if (this.stepping || this.status === "running")
      throw new Error("Cannot reset a running backtest session");
    this.currentIndex = 0;
    this.currentSymbolIndex = 0;
    this.barsProcessed = 0;
    this.status = "ready";

    BacktestExecutor.resetBacktestState(this.backtestId);
    this.run.destroy();
    if (this.stateManager) {
      await this.stateManager.clearExecutionScope(
        this.userId,
        this.workflowId,
        this.executionId,
      );
      if (this.indicatorWarmupSeed) {
        for (const symbol of this.indicatorWarmupSeed.symbols) {
          const bars =
            this.indicatorWarmupSeed.warmupBarsBySymbol.get(symbol) ?? [];
          for (const indicator of this.indicatorWarmupSeed.indicators) {
            const { candle_data, ...params } = indicator.params;
            await this.stateManager.warmUp(
              buildIndicatorKey(
                this.userId,
                this.workflowId,
                this.executionId,
                symbol,
                this.indicatorWarmupSeed.interval,
                indicator.nodeId,
              ),
              indicator.type,
              {
                ...params,
                symbol,
                timeframe: this.indicatorWarmupSeed.interval,
              },
              bars,
              false,
            );
          }
        }
      }
    }
    this.run = this.plan.createRun({
      executionId: this.executionId,
      workflowId: this.workflowId,
      userId: this.userId,
      mode: "best-effort",
      abortSignal: this.abortController.signal,
      executionMode: "backtest",
    });
    if (this.stateManager) this.run.setIndicatorStateManager(this.stateManager);
    if (this.rollingWindowSeed) {
      seedRollingWindows({
        ...this.rollingWindowSeed,
        userId: this.userId,
        workflowId: this.workflowId,
        executionId: this.executionId,
      });
    }
    this.run.clearNodeTiming();
    this.run.pinResults(this.backtestInitResult);
    this.tryCompilePlan();

    this.phase = "initializing";
    await this.initialize();

    await this.reportProgress();
  }

  cleanup(): void {
    this.abortController.abort();
    BacktestExecutor.cleanupBacktestResources(this.backtestId);
    this.run.destroy();
  }

  private async reportProgress(): Promise<void> {
    const percent =
      this.totalBars > 0
        ? Math.round((this.barsProcessed / this.totalBars) * 100)
        : 100;

    const redis = getRedisCache();
    await redis.set(
      RedisKeys.backtestProgress(this.userId, this.backtestId),
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
    let t0 = performance.now();
    try {
      await this.scanFinalEndExclusiveClock();
      const backtestExecutor = new BacktestExecutor();
      await backtestExecutor.finalizeBacktestById(this.backtestId);

      try {
        const lifecycleService = createWorkflowLifecycleService();
        await lifecycleService.deactivateAfterCompletion(
          this.userId,
          this.workflowId,
        );
      } catch (error) {
        console.error(
          `[BacktestSession] Auto-deactivate failed for workflow ${this.workflowId}:`,
          error,
        );
      }
    } catch (error) {
      console.error(
        `[BacktestSession] Finalization failed for ${this.backtestId}:`,
        error,
      );
    } finally {
      this.perf.finalizeMs += performance.now() - t0;
    }

    const timing = this.run.getNodeTiming();
    const redis = getRedisCache();
    t0 = performance.now();
    await redis.set(
      `backtest:timing:${this.backtestId}`,
      JSON.stringify(timing),
      "EX",
      3600,
    );
    this.perf.timingPersistMs += performance.now() - t0;
    console.log(
      `[BacktestSession] Node timing for ${this.backtestId}:`,
      timing,
    );
    t0 = performance.now();
    await redis.del(RedisKeys.backtestProgress(this.userId, this.backtestId));
    this.perf.progressCleanupMs += performance.now() - t0;
  }

  private async scanFinalEndExclusiveClock(): Promise<void> {
    if (this.finalClockScanned || process.env.ENABLE_CONSOLIDATOR_SCAN !== "true") return;
    this.finalClockScanned = true;
    const finalEvent = this.bars[this.bars.length - 1];
    if (!finalEvent) return;
    const requestedEnd = this.endExclusiveClock === undefined
      ? Number.NaN
      : new Date(this.endExclusiveClock).getTime();
    const clockAfterFinalSourceBar = new Date(finalEvent.timestamp).getTime() +
      parseTimeframe(finalEvent.interval).milliseconds;
    const endExclusive = Number.isFinite(requestedEnd)
      ? requestedEnd
      : clockAfterFinalSourceBar;
    await this.executeConsolidatorClock(new Date(endExclusive).toISOString());
  }
}
