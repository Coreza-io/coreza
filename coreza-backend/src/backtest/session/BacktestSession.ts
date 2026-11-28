import { randomUUID } from "crypto";
import { stringifyNodeResult } from "../../contracts/nodeResult";
import { getRedisCache } from "../../config/redis";
import { BacktestExecutor, toOnBarCandle } from "../BacktestExecutor";
import { NodeResult, WorkflowEdge, WorkflowNode } from "../../nodes/types";
import { buildIndicatorKey, IndicatorStateManager } from "../../engine/indicatorStateManager";
import { DataContextManager } from "../../engine/DataContext";
import { WorkflowPlan } from "../../engine/workflowPlan";
import { WorkflowRun } from "../../engine/workflowRun";
import { toExecutionError, type ExecutionError } from "../../engine/types";
import type { MultiBarExecutionContext } from "../../engine/types/executionContext";
import { BacktestBarCapture, BacktestBarHistory } from "./BacktestBarHistory";
import { compilePlan, runBar, CompiledPlan } from "../compiled";
import { resolveCategory } from "../compiled/adapters";
import { getNodeExecutor } from "../../nodes/registry";
import { RedisKeys } from "../../infra/redisKeys";
import { toMarketBarEnvelope } from "../simBroker/marketEnvelope";
import type { DiscoveredWarmupNode } from "../../nodes/executors/InitializeIndicatorsExecutor";
import type { BacktestPhase } from "../warmup/types";

export interface IndicatorInitialization {
  interval: string;
  symbols: string[];
  indicators: DiscoveredWarmupNode[];
}

export interface BarEvent {
  bar: any;
  symbol: string;
  interval: string;
  barIndex: number;
}

export interface MultiBarEvent {
  isWarmingUp?: boolean;
  timestamp: string;
  barIndex: number;
  interval: string;
  symbols: string[];
  bars: Record<string, any>;
}

export interface SymbolExecutionContext {
  isWarmingUp: boolean;
  multiBarContext: MultiBarExecutionContext;
}

interface PendingConsolidatorClose {
  nodeId: string;
  time: number;
  emit: () => NodeResult | undefined;
  sourceResults: Record<string, NodeResult>;
  context: MultiBarExecutionContext;
}

export type BacktestSessionStatus = "ready" | "running" | "finished";

export class BacktestSession {
  public currentIndex = 0;
  public status: BacktestSessionStatus = "ready";
  public phase: BacktestPhase = "initializing";

  private readonly plan: WorkflowPlan;
  private readonly barHistory?: BacktestBarHistory;
  private run: WorkflowRun;
  readonly stateManager?: IndicatorStateManager;
  indicatorsReadyAtStart = 0;
  editorConsolidatorScope = randomUUID();
  private abortController = new AbortController();
  private eventIndex = 0;
  private indicatorWarmupCompleted = false;
  readonly totalBars: number;
  private currentSymbolIndex = 0;
  private stepping = false;
  private initializing = false;
  get isExecuting(): boolean {
    return this.stepping || this.initializing;
  }
  get isWarmingUp(): boolean {
    return this.phase === "warming_up";
  }
  get isTradingBlocked(): boolean {
    return this.isWarmingUp || this.phase === "initializing" || this.abortController.signal.aborted
      || (this.status === "finished" && !this.indicatorWarmupCompleted);
  }
  private finalization: Promise<void> | null = null;
  private compiledPlan: CompiledPlan | null = null;
  private readonly reusableBarInput: { data: any } = { data: null };
  private readonly pendingConsolidatorCloses = new Map<string, PendingConsolidatorClose>();
  private readonly consolidatorCloseOrder: ReadonlyMap<string, number>;
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
      scheduleConsolidatorClose: (nodeId, key, endTime, emit, getResults, context) => {
        const time = Math.max(endTime, Date.parse(context.timestamp));
        if (!Number.isFinite(time) || this.strategyStartTime === undefined || time >= this.strategyStartTime) return;

        const sourceResults: Record<string, NodeResult> = Object.create(null);
        for (const [id, result] of Object.entries(getResults())) {
          if (result == null || Object.prototype.hasOwnProperty.call(this.backtestInitResult, id)) continue;
          // Some executors reuse result objects on the next candle.
          try {
            sourceResults[id] = structuredClone(result);
          } catch {
            sourceResults[id] = JSON.parse(stringifyNodeResult(result));
          }
        }
        const bars = context.bars;
        this.pendingConsolidatorCloses.set(JSON.stringify([nodeId, key]), {
          nodeId, time, emit, sourceResults,
          context: { ...context, timestamp: new Date(time).toISOString(), getBar: symbol => bars[symbol] },
        });
      },
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
  };

  constructor(
    public readonly backtestId: string,
    public readonly workflowId: string,
    public readonly nodeId: string,
    public readonly userId: string,
    private readonly nodes: WorkflowNode[],
    private readonly edges: WorkflowEdge[],
    private readonly entryNodeIds: string[],
    private readonly backtestInitResult: Record<string, any>,
    private readonly bars: MultiBarEvent[],
    public readonly executionId: string,
    stateManager?: IndicatorStateManager,
    private readonly indicatorInitialization?: IndicatorInitialization,
    public readonly persistResults = true,
    parentRunId?: string,
    private readonly strategyStartTime?: number,
  ) {
    if (persistResults && parentRunId && process.env.BACKTEST_EXECUTION_HISTORY_ENABLED === "true") {
      this.barHistory = new BacktestBarHistory(parentRunId, workflowId, userId);
    }
    this.totalBars = bars.filter((event) => !event.isWarmingUp).length;
    this.stateManager = stateManager;
    this.plan = WorkflowPlan.compile(this.nodes, this.edges, "backtest");
    this.consolidatorCloseOrder = new Map(this.plan.graph.topoSort().map((id, index) => [id, index]));
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

  private normalizeBarPayload(event: MultiBarEvent, isLast: boolean) {
    return {
      BarSeries: event.symbols
        .filter((symbol) => event.bars[symbol])
        .map((symbol) => ({
          symbol,
          interval: event.interval,
          bars: [toOnBarCandle(event.bars[symbol])],
        })),
      barIndex: event.barIndex,
      isWarmingUp: event.isWarmingUp === true,
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
              bars: [toOnBarCandle(bar)],
            },
          ]
        : [],
      barIndex: event.barIndex,
      isWarmingUp: event.isWarmingUp === true,
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
      event.isWarmingUp === true;
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
    this.initializing = true;
    try {
      await this.initializeState();
    } finally {
      this.initializing = false;
    }
  }

  private async initializeState(): Promise<void> {
    await this.run.initialize();
    await this.initializeIndicatorStates();
    this.setPhase(this.bars[0]?.isWarmingUp ? "warming_up" : "ready");
    this.status = "ready";
  }

  private setPhase(phase: BacktestPhase): void {
    if (phase === this.phase) return;
    if (phase === "finished") this.pendingConsolidatorCloses.clear();
    this.phase = phase;
    BacktestExecutor.getSimBrokerForBacktest(this.backtestId)?.setWarmingUp(phase === "warming_up");
  }

  private beginEvent(event: MultiBarEvent): void {
    this.status = "running";
    if (event.isWarmingUp) {
      this.setPhase("warming_up");
      return;
    }
    if (!this.indicatorWarmupCompleted) {
      this.indicatorsReadyAtStart = this.stateManager?.completeWarmup() ?? 0;
      this.indicatorWarmupCompleted = true;
    }
    this.setPhase("running");
  }

  private async scanWarmupConsolidators(before: number): Promise<void> {
    if (!this.isWarmingUp) return;
    while (this.pendingConsolidatorCloses.size > 0) {
      const due = [...this.pendingConsolidatorCloses.entries()]
        .filter(([, close]) => close.time < before)
        .sort(([, left], [, right]) => left.time - right.time
          || (this.consolidatorCloseOrder.get(left.nodeId) ?? this.nodes.length)
            - (this.consolidatorCloseOrder.get(right.nodeId) ?? this.nodes.length))[0];
      if (!due) return;
      const [key, { nodeId, emit, sourceResults, context }] = due;
      this.pendingConsolidatorCloses.delete(key);
      this.abortController.signal.throwIfAborted();
      const result = emit();
      if (!result) continue;

      // This is a consolidator callback, with no new source candle to ingest.
      if (this.compiledPlan) {
        this.compiledPlan.ctx.multiBarContext = context;
        this.compiledPlan.ctx.isWarmingUp = true;
        await runBar(this.compiledPlan, null, true, undefined, { nodeId, result, sourceResults });
      } else {
        this.run.resetForNextBar();
        this.run.setExecutionContextExtras({ multiBarContext: context, isWarmingUp: true });
        this.run.seedContext(sourceResults);
        const execution = await this.run.executeFromResult(nodeId, result);
        if (!execution.success) throw new Error(execution.error?.message ?? "Backtest consolidation failed");
      }
      this.abortController.signal.throwIfAborted();
    }
  }

  private advanceEvent(event: MultiBarEvent): boolean {
    this.eventIndex += 1;
    this.currentSymbolIndex = 0;
    if (!event.isWarmingUp) this.currentIndex += 1;
    return this.eventIndex >= this.bars.length;
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
    const symbols = this.currentSymbolIndex ? event.symbols.slice(this.currentSymbolIndex) : event.symbols;
    let t0 = performance.now();

    for (const symbol of symbols) {
      const bar = event.bars[symbol];
      if (bar) {
        const envelope = toMarketBarEnvelope(symbol, bar, event.timestamp);
        if (envelope) {
          BacktestExecutor.getSimBrokerForBacktest(this.backtestId)?.onBar(envelope);
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

      this.abortController.signal.throwIfAborted();
      if (this.barHistory && !this.barHistory.failure) {
        await this.executeCapturedBar(this.barHistory, symbolEvent, event.timestamp);
      } else if (this.compiledPlan) {
        t0 = performance.now();
        this.reusableBarInput.data = symbolEvent;
        await runBar(this.compiledPlan, this.reusableBarInput, true);
        this.perf.executeLoopMs += performance.now() - t0;
      } else {
        t0 = performance.now();
        this.run.resetForNextBar();
        this.perf.resetMs += performance.now() - t0;
        this.perf.storeClearMs += this.run.lastStoreClearMs;
        t0 = performance.now();
        const result = await this.run.executeFromEntries({ data: symbolEvent }, this.entryNodeIds);
        this.perf.buildResultMs += this.run.lastBuildResultMs;
        if (!result.success) throw new Error(result.error?.message ?? "Backtest strategy failed");
        this.perf.executeLoopMs += performance.now() - t0;
      }

      this.perf.symbolExecutions += 1;
    }

    if (event.isWarmingUp || this.abortController.signal.aborted) return;
    const snapshotTimestamp = this.buildSnapshotTimestamp(event);
    t0 = performance.now();
    BacktestExecutor.getSimBrokerForBacktest(
      this.backtestId,
    )?.recordEquitySnapshot(snapshotTimestamp);
    this.perf.equitySnapshotMs += performance.now() - t0;
  }

  private async executeCapturedBar(
    history: BacktestBarHistory, event: BarEvent, barTime: string,
  ): Promise<void> {
    const capture = new BacktestBarCapture();
    const startedAt = performance.now();
    let strategyError: ExecutionError | undefined;
    try {
      if (this.compiledPlan) {
        this.reusableBarInput.data = event;
        await runBar(this.compiledPlan, this.reusableBarInput, true, capture.observe);
      } else {
        this.run.resetForNextBar();
        this.perf.storeClearMs += this.run.lastStoreClearMs;
        this.run.setNodeResultObserver(capture.observe);
        const result = await this.run.executeFromEntries({ data: event }, this.entryNodeIds);
        this.perf.buildResultMs += this.run.lastBuildResultMs;
        if (!result.success) {
          strategyError = result.error ?? { code: "BACKTEST_FAILED", message: "Backtest strategy failed", phase: "execute" };
        }
      }
    } catch (error) {
      strategyError = toExecutionError(error, "execute");
    } finally {
      if (!this.compiledPlan) this.run.setNodeResultObserver();
      this.perf.executeLoopMs += performance.now() - startedAt;
    }

    const cancelled = this.abortController.signal.aborted;
    if (cancelled && (!strategyError || strategyError.code === "CANCELLED")) {
      const reason = this.abortController.signal.reason;
      strategyError = {
        code: "CANCELLED",
        message: reason instanceof Error ? reason.message : "Workflow cancelled by user",
        phase: "execute",
      };
    }
    const status = cancelled ? "cancelled" : strategyError ? "failed" : "success";
    await history.record(event.barIndex, event.symbol, barTime, capture, status, strategyError);
    if (strategyError) throw new Error(strategyError.message);
  }

  async step(): Promise<Record<string, any>> {
    return this.nextBar();
  }

  private async executeNextTimestamp(
    manual = false,
  ): Promise<Record<string, any>> {
    if (this.isExecuting) {
      throw new Error("Step already in progress");
    }

    this.stepping = true;
    try {
      this.abortController.signal.throwIfAborted();
      if (this.status === "finished" || this.eventIndex >= this.bars.length) {
        this.status = "finished";
        return { isLast: true, total_bars: this.totalBars };
      }

      const event = this.bars[this.eventIndex];
      if (!manual) await this.scanWarmupConsolidators(Date.parse(event.timestamp));
      this.beginEvent(event);
      if (manual) {
        const symbolIndex = this.currentSymbolIndex;
        const symbol = event.symbols[symbolIndex];
        const broker = BacktestExecutor.getSimBrokerForBacktest(this.backtestId);
        const envelope = toMarketBarEnvelope(symbol, event.bars[symbol], event.timestamp);
        if (envelope) broker?.onBar(envelope);

        this.currentSymbolIndex += 1;
        const consumedTimestamp = this.currentSymbolIndex >= event.symbols.length;
        let isLast = false;
        if (consumedTimestamp) {
          if (!event.isWarmingUp) broker?.recordEquitySnapshot(event.timestamp);
          isLast = this.advanceEvent(event);
        }
        await this.reportStepProgress(event, consumedTimestamp, isLast);
        return this.normalizeManualBarPayload(event, symbol, symbolIndex, isLast);
      }

      await this.executeTimestamp(event);
      this.abortController.signal.throwIfAborted();
      const isLast = this.advanceEvent(event);
      if (isLast && this.strategyStartTime !== undefined) {
        await this.scanWarmupConsolidators(Math.min(this.strategyStartTime, Date.now()));
      }
      await this.reportStepProgress(event, true, isLast);
      return this.normalizeBarPayload(event, isLast);
    } catch (error) {
      this.abortController.abort(error);
      this.status = "finished";
      this.setPhase("finished");
      throw error;
    } finally {
      this.stepping = false;
    }
  }

  private async reportStepProgress(event: MultiBarEvent, consumedTimestamp: boolean, isLast: boolean): Promise<void> {
    if (isLast) {
      this.status = "finished";
      // The last manual response still controls the broker until reset or Run.
      if (!event.isWarmingUp) this.setPhase("finished");
    }
    if (isLast || (consumedTimestamp && !event.isWarmingUp && this.currentIndex % 1000 === 0)) {
      await this.reportProgress();
    }
  }

  async nextBar(manual = false): Promise<Record<string, any>> {
    return this.executeNextTimestamp(manual);
  }

  async runAll(): Promise<void> {
    try {
      await this.runBatch();
    } catch (error) {
      const historyFailure = this.barHistory?.failure;
      if (historyFailure) {
        const executionError = error instanceof Error ? error.message : String(error);
        throw new Error(`${historyFailure.message}. Backtest: ${executionError}`, { cause: error });
      }
      throw error;
    }
    if (this.barHistory?.failure) throw this.barHistory.failure;
  }

  private async runBatch(): Promise<void> {
    if (this.abortController.signal.aborted) {
      throw this.abortController.signal.reason ?? new Error("Workflow cancelled by user");
    }
    if (this.isExecuting) throw new Error("Step already in progress");
    if (this.status === "finished") {
      this.setPhase("finished");
      await this.finalize();
      return;
    }

    // Manual BacktestInit/OnBar sessions do not need strategy compilation.
    // Promote the same session lazily only at the explicit historical entry point.
    this.tryCompilePlan();

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
      };

      let lastProgressTime = performance.now();
      while (this.eventIndex < this.bars.length && !signal.aborted) {
        const chunkEnd = Math.min(this.eventIndex + 5000, this.bars.length);
        while (this.eventIndex < chunkEnd && !signal.aborted) {
          const event = this.bars[this.eventIndex];
          if (this.pendingConsolidatorCloses.size > 0) {
            await this.scanWarmupConsolidators(Date.parse(event.timestamp));
          }
          let startedAt = performance.now();
          this.beginEvent(event);
          this.perf.runnerBookkeepingMs += performance.now() - startedAt;
          await this.executeTimestamp(event);
          signal.throwIfAborted();
          startedAt = performance.now();
          this.advanceEvent(event);
          this.perf.runnerBookkeepingMs += performance.now() - startedAt;
        }

        const now = performance.now();
        if (now - lastProgressTime >= 2000 || this.eventIndex >= this.bars.length) {
          await this.reportProgressTimed();
          lastProgressTime = now;
        }
        if (this.eventIndex < this.bars.length && !signal.aborted) await this.yieldToEventLoop();
      }
      if (this.strategyStartTime !== undefined && !signal.aborted) {
        await this.scanWarmupConsolidators(Math.min(this.strategyStartTime, Date.now()));
      }
    } catch (error) {
      this.abortController.abort(error);
      throw error;
    } finally {
      this.status = "finished";
      this.setPhase("finished");
      try {
        if (this.barHistory) await this.barHistory.flush();
      } finally {
        this.stepping = false;
      }
    }

    this.abortController.signal.throwIfAborted();
    await this.finalize();
    this.logRunAllBenchmark(performance.now() - this.perf.totalStart);
  }

  getLatestNodeSnapshots(): Record<string, NodeResult> {
    const results = this.compiledPlan
      ? this.compiledPlan.ctx.getAllNodeResults()
      : this.run.getLatestNodeResults();
    const snapshots: Record<string, NodeResult> = {};
    for (const { id } of this.nodes) {
      const result = results[id];
      if (Object.prototype.hasOwnProperty.call(results, id) && result != null) snapshots[id] = result;
    }
    return snapshots;
  }

  async reset(): Promise<void> {
    if (this.isExecuting || (this.persistResults && this.status === "running"))
      throw new Error("Cannot reset a running backtest session");
    if (this.finalization && this.persistResults) throw new Error("Start a new backtest to reset a finalized session");
    this.stepping = true;
    try {
      if (this.finalization) await this.finalization;
      await this.resetState();
    } catch (error) {
      this.abortController.abort(error);
      this.status = "finished";
      this.setPhase("finished");
      throw error;
    } finally {
      this.stepping = false;
    }
  }

  private async resetState(): Promise<void> {
    if (!this.persistResults) this.finalization = null;
    this.currentIndex = 0;
    this.eventIndex = 0;
    this.currentSymbolIndex = 0;
    this.status = "ready";
    this.pendingConsolidatorCloses.clear();
    this.setPhase("initializing");
    this.indicatorWarmupCompleted = false;
    this.indicatorsReadyAtStart = 0;
    this.editorConsolidatorScope = randomUUID();
    this.abortController = new AbortController();

    BacktestExecutor.resetBacktestState(this.backtestId);
    this.run.destroy();
    if (this.stateManager) {
      await this.stateManager.clearExecutionScope(this.userId, this.workflowId, this.executionId);
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
    this.run.clearNodeTiming();
    this.run.pinResults(this.backtestInitResult);
    this.compiledPlan = null;

    await this.initialize();

    await this.reportProgress();
  }

  cleanup(): void {
    this.cancel();
    this.setPhase("finished");
    BacktestExecutor.cleanupBacktestResources(this.backtestId);
    this.run.destroy();
  }

  cancel(reason?: unknown): void {
    this.abortController.abort(reason);
    if (!this.isExecuting) {
      this.status = "finished";
      this.setPhase("finished");
    }
  }

  private async reportProgress(): Promise<void> {
    if (!this.persistResults) return;
    const percent =
      this.totalBars > 0
        ? Math.round((this.currentIndex / this.totalBars) * 100)
        : 100;

    const redis = getRedisCache();
    await redis.set(
      RedisKeys.backtestProgress(this.userId, this.backtestId),
      JSON.stringify({
        backtestId: this.backtestId,
        barsProcessed: this.currentIndex,
        totalBars: this.totalBars,
        percent,
        updatedAt: new Date().toISOString(),
      }),
      "EX",
      3600,
    );
  }

  private finalize(): Promise<void> {
    // Repeated completion calls share the same persistence operation, including failures.
    return this.finalization ??= this.finalizeResults();
  }

  private async finalizeResults(): Promise<void> {
    let t0 = performance.now();
    try {
      const backtestExecutor = new BacktestExecutor();
      await backtestExecutor.finalizeBacktestById(this.backtestId, this.abortController.signal);
    } finally {
      this.perf.finalizeMs += performance.now() - t0;
    }

    if (!this.persistResults) return;
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
}
