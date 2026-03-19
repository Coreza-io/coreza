import { DataContext, DataContextManager } from "./DataContext";
import { BacktestExecutionRuntime, BaseExecutionRuntime, StandardExecutionRuntime } from "./executionRuntime";
import { IndicatorStateManager } from "./indicatorStateManager";
import { NodeStoreV2 } from "./nodeStoreV2";
import { ENGINE_CONFIG } from "./config/engineConfig";
import { WorkflowPlan } from "./workflowPlan";
import { FlushPolicy, WorkflowExecutionResult, toExecutionError } from "./types";

export class WorkflowRun {
  private store: NodeStoreV2;
  private runtime: BaseExecutionRuntime;
  private dataContext: DataContext;
  private indicatorStateManager: IndicatorStateManager;
  private readonly flushPolicy: FlushPolicy;

  constructor(
    private readonly plan: WorkflowPlan,
    private readonly opts: {
      runId: string;
      workflowId: string;
      userId: string;
      mode?: "best-effort" | "fail-fast";
      abortSignal?: AbortSignal;
      flushPolicy?: FlushPolicy;
    },
  ) {
    this.flushPolicy = opts.flushPolicy ??
      (plan.isBacktest ? ENGINE_CONFIG.BACKTEST_FLUSH_POLICY : ENGINE_CONFIG.DEFAULT_FLUSH_POLICY);
    this.store = new NodeStoreV2(opts.runId, [...plan.nodes]);
    this.dataContext = DataContextManager.getInstance().getContext({
      runId: opts.runId,
      workflowId: opts.workflowId,
      userId: opts.userId,
    });
    this.indicatorStateManager = new IndicatorStateManager(
      plan.isBacktest ? ENGINE_CONFIG.BACKTEST_INDICATOR_RETENTION_SECONDS : undefined,
    );
    this.runtime = this.buildRuntime();
  }

  private buildRuntime(): BaseExecutionRuntime {
    const runtimeOpts = {
      runId: this.opts.runId,
      workflowId: this.opts.workflowId,
      userId: this.opts.userId,
      mode: this.opts.mode ?? "best-effort",
      abortSignal: this.opts.abortSignal,
      isBacktest: this.plan.isBacktest,
      nodes: [...this.plan.nodes],
      edges: [...this.plan.edges],
      nodeExecutorMap: this.plan.nodeExecutorMap,
      dataContext: this.dataContext,
      indicatorStateManager: this.indicatorStateManager,
    };

    return this.plan.isBacktest
      ? new BacktestExecutionRuntime(this.plan.graph, this.store, this.plan.resolver, runtimeOpts)
      : new StandardExecutionRuntime(this.plan.graph, this.store, this.plan.resolver, runtimeOpts);
  }

  async execute(initialInput?: unknown, startNodeId?: string): Promise<WorkflowExecutionResult> {
    try {
      if (startNodeId && this.plan.graph.nodeById.has(startNodeId)) {
        this.runtime.enqueue({ nodeId: startNodeId, input: initialInput });
      } else {
        for (const entryId of this.plan.entryNodeIds) {
          this.runtime.enqueue({ nodeId: entryId, input: initialInput });
        }
      }
      await this.drainQueue();
      return this.buildResult();
    } catch (error) {
      return this.buildExceptionResult(error);
    } finally {
      await this.flushIfNeeded();
    }
  }

  async executeFromEntries(input: unknown, entryNodeIds: string[]): Promise<WorkflowExecutionResult> {
    try {
      for (const entryNodeId of entryNodeIds) {
        this.runtime.primeEntry(entryNodeId, input);
        this.runtime.enqueue({ nodeId: entryNodeId, input });
      }
      await this.drainQueue();
      return this.buildResult();
    } catch (error) {
      return this.buildExceptionResult(error);
    } finally {
      await this.flushIfNeeded();
    }
  }

  resetForNextBar(full = false): void { this.runtime.resetForNextBar(full); }

  /**
   * Pin results that survive clearResults()/resetForNextBar().
   * Used for BacktestInit outputs that do not change across bars.
   */
  pinResults(results: Record<string, any>): void {
    this.store.pinResults(results);
  }

  /**
   * Pre-set node results in the store before execution.
   * Useful for sub-workflow outputs or other precomputed values.
   */
  preloadResults(results: Record<string, any>): void {
    for (const [nodeId, result] of Object.entries(results)) {
      this.store.setNodeResult(nodeId, result);
    }
  }
  getNodeState(nodeId: string, key: string): any { return this.store.getNodeState(nodeId, key); }
  setNodeState(nodeId: string, key: string, value: any): void { this.store.setNodeState(nodeId, key, value); }
  setIndicatorStateManager(manager: IndicatorStateManager): void { this.indicatorStateManager = manager; this.runtime = this.buildRuntime(); }
  getIndicatorStateManager(): IndicatorStateManager { return this.indicatorStateManager; }
  getDataContext(): DataContext { return this.dataContext; }
  getNodeTiming() { return this.runtime.getNodeTiming(); }
  clearNodeTiming(): void { this.runtime.clearNodeTiming(); }
  getCompiledParams() { return this.plan.resolver.getCompiledParams(); }
  getNodeExecutorMap() { return this.runtime.getNodeExecutorMap(); }
  setExecutionContextExtras(extras: Partial<{ multiBarContext: any }>): void {
    this.runtime.setExecutionContextExtras(extras);
  }
  checkCancellation(): boolean { return this.opts.abortSignal?.aborted ?? false; }

  destroy(): void {
    DataContextManager.getInstance().destroyContext(this.opts.runId);
    this.indicatorStateManager.clearL1Cache();
  }

  private async drainQueue(): Promise<void> {
    while (this.runtime.hasPending()) {
      if (this.opts.abortSignal?.aborted) throw new Error("Workflow cancelled by user");
      const item = this.runtime.dequeue();
      if (!item) break;
      const maybePromise = this.runtime.executeOnce(item);
      if (maybePromise) await maybePromise;
    }
  }

  private buildResult(): WorkflowExecutionResult {
    if (this.runtime.hasFailures()) {
      return {
        success: false,
        error: {
          code: "NODE_FAILED",
          message: this.runtime.getFailureMessage() ?? "Workflow completed with failures",
          phase: "execute",
        },
        result: this.store.getAllResults() ?? {},
        executionOrder: this.runtime.getExecutionOrder(),
      };
    }

    return {
      success: true,
      result: this.store.getAllResults() ?? {},
      executionOrder: this.runtime.getExecutionOrder(),
    };
  }

  private buildExceptionResult(error: unknown): WorkflowExecutionResult {
    return {
      success: false,
      error: toExecutionError(error, "execute"),
      result: this.store.getAllResults() ?? {},
      executionOrder: this.runtime.getExecutionOrder(),
    };
  }

  private async flushIfNeeded(): Promise<void> {
    const shouldFlush =
      this.flushPolicy === "always" ||
      (this.flushPolicy === "on-success" && !this.runtime.hasFailures());
    if (shouldFlush) {
      await this.indicatorStateManager.flushToRedis().catch(() => {});
    }
  }
}
