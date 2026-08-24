import { DataContext, DataContextManager } from "./DataContext";
import {
  BacktestExecutionRuntime,
  BaseExecutionRuntime,
  StandardExecutionRuntime,
} from "./executionRuntime";
import { IndicatorStateManager } from "./indicatorStateManager";
import { NodeStoreV2 } from "./nodeStoreV2";
import { ENGINE_CONFIG } from "./config/engineConfig";
import { WorkflowPlan } from "./workflowPlan";
import {
  ExecutionMode,
  FlushPolicy,
  MultiBarExecutionContext,
  WorkflowExecutionResult,
  toExecutionError,
} from "./types";
import type { ConsolidatorEmission } from "./consolidation/consolidatorScan";

type NodeResults = NonNullable<WorkflowExecutionResult["nodeResults"]>;

interface WorkflowRunOptions {
  executionId: string;
  workflowId: string;
  userId: string;
  mode?: "best-effort" | "fail-fast";
  abortSignal?: AbortSignal;
  flushPolicy?: FlushPolicy;
  executionMode: ExecutionMode;
}

interface ExecutionContextExtras {
  multiBarContext?: MultiBarExecutionContext;
  runId?: string;
  isWarmingUp?: boolean;
}

export class WorkflowRun {
  private _lastBuildResultMs = 0;

  private readonly store: NodeStoreV2;
  private runtime: BaseExecutionRuntime;
  private readonly dataContext: DataContext;
  private indicatorStateManager: IndicatorStateManager;
  private readonly flushPolicy: FlushPolicy;

  constructor(
    private readonly plan: WorkflowPlan,
    private readonly options: WorkflowRunOptions,
  ) {
    this.flushPolicy =
      options.flushPolicy ??
      (plan.isBacktest
        ? ENGINE_CONFIG.BACKTEST_FLUSH_POLICY
        : ENGINE_CONFIG.DEFAULT_FLUSH_POLICY);

    this.store = new NodeStoreV2(
      options.executionId,
      [...plan.nodes],
      options.userId,
      options.workflowId,
    );

    this.dataContext = DataContextManager.getInstance().getContext({
      executionId: options.executionId,
      workflowId: options.workflowId,
      userId: options.userId,
    });

    this.indicatorStateManager = new IndicatorStateManager(
      plan.isBacktest
        ? ENGINE_CONFIG.BACKTEST_INDICATOR_RETENTION_SECONDS
        : undefined,
    );

    this.runtime = this.buildRuntime();
  }

  get lastBuildResultMs(): number {
    return this._lastBuildResultMs;
  }

  get lastStoreClearMs(): number {
    return this.runtime instanceof BacktestExecutionRuntime
      ? this.runtime.lastStoreClearMs
      : 0;
  }

  private buildRuntime(): BaseExecutionRuntime {
    const runtimeOptions = {
      executionId: this.options.executionId,
      workflowId: this.options.workflowId,
      userId: this.options.userId,
      mode: this.options.mode ?? "best-effort",
      abortSignal: this.options.abortSignal,
      executionMode: this.plan.executionMode,
      nodes: [...this.plan.nodes],
      edges: [...this.plan.edges],
      nodeExecutorMap: this.plan.nodeExecutorMap,
      dataContext: this.dataContext,
      indicatorStateManager: this.indicatorStateManager,
    };

    return this.plan.isBacktest
      ? new BacktestExecutionRuntime(
          this.plan.graph,
          this.store,
          this.plan.resolver,
          runtimeOptions,
        )
      : new StandardExecutionRuntime(
          this.plan.graph,
          this.store,
          this.plan.resolver,
          runtimeOptions,
        );
  }

  async execute(
    initialInput?: unknown,
    startNodeId?: string,
  ): Promise<WorkflowExecutionResult> {
    return this.runExecution(() => {
      if (startNodeId !== undefined) {
        this.ensureNodeExists(startNodeId);
        this.runtime.enqueue({ nodeId: startNodeId, input: initialInput });
        return;
      }

      for (const entryNodeId of this.plan.entryNodeIds) {
        this.runtime.enqueue({ nodeId: entryNodeId, input: initialInput });
      }
    });
  }

  async executeFromEntries(
    input: unknown,
    entryNodeIds: string[],
  ): Promise<WorkflowExecutionResult> {
    return this.runExecution(() => {
      for (const entryNodeId of entryNodeIds) {
        this.ensureNodeExists(entryNodeId);
        this.runtime.primeEntry(entryNodeId, input);
        this.runtime.enqueue({ nodeId: entryNodeId, input });
      }
    });
  }

  async executeInjectedResults(
    emissions: readonly ConsolidatorEmission[],
    onBatchSuccess?: (delivered: readonly ConsolidatorEmission[]) => void,
  ): Promise<WorkflowExecutionResult> {
    const symbols = new Set(emissions.map((emission) => emission.payload.symbol));
    if (symbols.size > 1) {
      let lastResult: WorkflowExecutionResult | undefined;
      for (const symbol of symbols) {
        lastResult = await this.executeInjectedResults(
          emissions.filter((emission) => emission.payload.symbol === symbol),
          onBatchSuccess,
        );
        if (!lastResult.success) return lastResult;
      }
      return lastResult ?? { success: true, nodeResults: {}, executionOrder: [] };
    }
    const result = await this.runExecution(() => {
      this.runtime.resetForNextBar(true);
      for (const emission of emissions) {
        this.ensureNodeExists(emission.nodeId);
        this.runtime.injectResult(emission.nodeId, {
          success: true,
          data: emission.payload,
        });
      }
    });
    if (result.success) onBatchSuccess?.(emissions);
    return result;
  }

  resetForNextBar(full = false): void {
    this.runtime.resetForNextBar(full);
  }

  /**
   * Pin results that survive clearResults()/resetForNextBar().
   * Used for BacktestInit outputs that do not change across bars.
   */
  pinResults(results: NodeResults): void {
    this.store.pinResults(results);
  }

  /**
   * Pre-set node results in the store before execution.
   * Useful for sub-workflow outputs or other precomputed values.
   */
  preloadResults(results: NodeResults): void {
    const order = this.runtime.getExecutionOrder();
    for (const [nodeId, result] of Object.entries(results)) {
      this.store.setNodeResult(nodeId, result);
      order.push(nodeId);
    }
  }

  getNodeState(nodeId: string, key: string): unknown {
    return this.store.getNodeState(nodeId, key);
  }

  setNodeState(nodeId: string, key: string, value: unknown): void {
    this.store.setNodeState(nodeId, key, value);
  }

  /**
   * Rebuilds the runtime with a new indicator state manager.
   * Prefer calling this before execution starts.
   */
  setIndicatorStateManager(manager: IndicatorStateManager): void {
    this.indicatorStateManager = manager;
    this.runtime = this.buildRuntime();
  }

  getIndicatorStateManager(): IndicatorStateManager {
    return this.indicatorStateManager;
  }

  getDataContext(): DataContext {
    return this.dataContext;
  }

  getNodeTiming(): ReturnType<BaseExecutionRuntime["getNodeTiming"]> {
    return this.runtime.getNodeTiming();
  }

  clearNodeTiming(): void {
    this.runtime.clearNodeTiming();
  }

  getCompiledParams(): ReturnType<
    WorkflowPlan["resolver"]["getCompiledParams"]
  > {
    return this.plan.resolver.getCompiledParams();
  }

  getNodeExecutorMap(): ReturnType<BaseExecutionRuntime["getNodeExecutorMap"]> {
    return this.runtime.getNodeExecutorMap();
  }

  setExecutionContextExtras(extras: ExecutionContextExtras): void {
    this.runtime.setExecutionContextExtras(extras);
  }

  setRunId(runId: string): void {
    this.runtime.setExecutionContextExtras({ runId });
  }

  checkCancellation(): boolean {
    return this.options.abortSignal?.aborted ?? false;
  }

  destroy(): void {
    DataContextManager.getInstance().destroyContext(this.options.executionId);
    this.indicatorStateManager.clearL1Cache();
  }

  private async runExecution(
    enqueueWork: () => void,
  ): Promise<WorkflowExecutionResult> {
    this._lastBuildResultMs = 0;

    try {
      enqueueWork();
      await this.drainQueue();

      const startedAtMs = performance.now();
      const executionResult = this.buildExecutionResult();
      this._lastBuildResultMs = performance.now() - startedAtMs;

      return executionResult;
    } catch (error) {
      return this.buildFailureResult(error);
    } finally {
      await this.flushIfNeeded();
    }
  }

  private ensureNodeExists(nodeId: string): void {
    if (!this.plan.graph.nodeById.has(nodeId)) {
      throw new Error(`Unknown start node: ${nodeId}`);
    }
  }

  private async drainQueue(): Promise<void> {
    while (this.runtime.hasPending()) {
      if (this.options.abortSignal?.aborted) {
        throw new Error("Workflow cancelled by user");
      }

      const queueItem = this.runtime.dequeue();
      if (!queueItem) break;

      const maybePromise = this.runtime.executeOnce(queueItem);
      if (maybePromise) {
        await maybePromise;
      }
    }
  }

  private buildExecutionResult(): WorkflowExecutionResult {
    const nodeResults = this.store.getAllResults() ?? {};
    const executionOrder = this.runtime.getExecutionOrder();
    const timing = this.runtime.getNodeTiming();

    if (this.runtime.hasFailures()) {
      return {
        success: false,
        error: {
          code: "NODE_FAILED",
          message:
            this.runtime.getFailureMessage() ??
            "Workflow completed with failures",
          phase: "execute",
        },
        nodeResults,
        executionOrder,
        timing,
      };
    }

    return {
      success: true,
      nodeResults,
      executionOrder,
      timing,
    };
  }

  private buildFailureResult(error: unknown): WorkflowExecutionResult {
    const nodeResults = this.store.getAllResults() ?? {};
    const executionOrder = this.runtime.getExecutionOrder();
    const timing = this.runtime.getNodeTiming();

    return {
      success: false,
      error: toExecutionError(error, "execute"),
      nodeResults,
      executionOrder,
      timing,
    };
  }

  private async flushIfNeeded(): Promise<void> {
    const shouldFlush =
      this.flushPolicy === "always" ||
      (this.flushPolicy === "on-success" && !this.runtime.hasFailures());

    if (!shouldFlush) {
      return;
    }

    try {
      await this.indicatorStateManager.flushToRedis();
    } catch (error) {
      console.warn(
        "[WorkflowRun] flushToRedis failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
