import { performance } from "perf_hooks";
import { resolveCategory } from "../nodes/categoryMap";
import { getNodeExecutor } from "../nodes/registry";
import {
  IterMeta,
  NodeResult,
  QueueItem,
  WorkflowEdge,
  WorkflowNode,
  INodeExecutor,
} from "../nodes/types";
import { DataContext } from "./DataContext";
import { GraphRuntime } from "./graphRuntime";
import { IndicatorStateManager } from "./indicatorStateManager";
import { NodeQueueManager } from "./nodeQueueManager";
import { NodeStoreV2 } from "./nodeStoreV2";
import { ParameterResolver } from "./parameterResolver";
import { ExecutionMode, NodeExecutionContext } from "./types";
import { enforceWarmupPolicy } from "../backtest/warmup/WarmupPolicy";

export type RuntimeOptions = {
  executionId: string;
  workflowId: string;
  userId: string;
  mode: "best-effort" | "fail-fast";
  abortSignal?: AbortSignal;
  executionMode: ExecutionMode;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  nodeExecutorMap?: ReadonlyMap<string, INodeExecutor>;
  dataContext: DataContext;
  indicatorStateManager: IndicatorStateManager;
};

type ExecutionContextExtras = Partial<
  Pick<NodeExecutionContext, "multiBarContext" | "runId" | "isWarmingUp" | "emissionId">
>;

export abstract class BaseExecutionRuntime {
  protected readonly queue = new NodeQueueManager();
  protected readonly nodeExecutorMap = new Map<string, INodeExecutor>();
  protected readonly nodeTiming = new Map<
    string,
    { totalMs: number; count: number }
  >();
  protected readonly failed = new Set<string>();
  protected readonly failedNodeErrors = new Map<string, string>();
  protected readonly executionOrder: string[] = [];
  protected execCtx: NodeExecutionContext | null = null;
  protected executionContextExtras: ExecutionContextExtras = {};

  constructor(
    protected readonly graph: GraphRuntime,
    protected readonly store: NodeStoreV2,
    protected readonly resolver: ParameterResolver,
    protected readonly options: RuntimeOptions,
  ) {
    if (options.nodeExecutorMap) {
      for (const [id, exec] of options.nodeExecutorMap) {
        this.nodeExecutorMap.set(id, exec);
      }
      return;
    }

    for (const node of options.nodes) {
      const exec = getNodeExecutor(resolveCategory(node));
      if (exec) this.nodeExecutorMap.set(node.id, exec);
    }
  }

  hasPending(): boolean {
    return this.queue.length > 0;
  }

  enqueue(item: QueueItem): boolean {
    this.queue.enqueue(item);
    return true;
  }

  dequeue(): QueueItem | undefined {
    return this.queue.dequeue();
  }

  getExecutionOrder(): string[] {
    return this.executionOrder;
  }

  getNodeExecutorMap(): ReadonlyMap<string, INodeExecutor> {
    return this.nodeExecutorMap;
  }

  hasFailures(): boolean {
    return this.failed.size > 0;
  }

  getFailureMessage(): string | undefined {
    const firstFailedNodeId = Array.from(this.failed)[0];
    if (!firstFailedNodeId) return undefined;
    return (
      this.failedNodeErrors.get(firstFailedNodeId) ||
      "Workflow completed with failures"
    );
  }

  clearNodeTiming(): void {
    this.nodeTiming.clear();
  }

  getNodeTiming(): Record<
    string,
    { avgMs: number; totalMs: number; count: number }
  > {
    const result: Record<
      string,
      { avgMs: number; totalMs: number; count: number }
    > = {};
    for (const [id, timing] of this.nodeTiming) {
      result[id] = {
        avgMs: +(timing.totalMs / timing.count).toFixed(3),
        totalMs: +timing.totalMs.toFixed(3),
        count: timing.count,
      };
    }
    return result;
  }

  protected getExecutionContext(nodeId: string): NodeExecutionContext {
    if (!this.execCtx) {
      const ctx: NodeExecutionContext = {
        user_id: this.options.userId,
        userId: this.options.userId,
        executionId: this.options.executionId,
        runId: this.options.executionId,
        workflowId: this.options.workflowId,
        nodeId,
        nodes: this.options.nodes,
        edges: this.options.edges,
        resolvedParams: {},
        resolveNodeParameters: (node: WorkflowNode, input: any) => {
          const resolved = this.resolver.resolve(
            node,
            input,
            () => this.store.getAllResults() ?? {},
          );
          ctx.resolvedParams = resolved;
          return resolved;
        },
        getAllNodeResults: () => this.store.getAllResults() ?? {},
        dataContext: this.options.dataContext,
        indicatorStateManager: this.options.indicatorStateManager,
        abortSignal: this.options.abortSignal,
        checkCancellation: () => this.options.abortSignal?.aborted ?? false,
        executionMode: this.options.executionMode,
        isWarmingUp: false,
        getState: (key: string) => this.store.getNodeState(ctx.nodeId, key),
        setState: (key: string, value: any) =>
          this.store.setNodeState(ctx.nodeId, key, value),
      };
      this.execCtx = ctx;
    }

    this.execCtx.nodeId = nodeId;
    Object.assign(this.execCtx, this.executionContextExtras);
    return this.execCtx;
  }

  setExecutionContextExtras(extras: ExecutionContextExtras): void {
    this.executionContextExtras = extras;
    if (this.execCtx) {
      Object.assign(this.execCtx, extras);
    }
  }

  injectResult(nodeId: string, result: NodeResult): void {
    const node = this.graph.nodeById.get(nodeId);
    if (!node) throw new Error(`Unknown injected result node: ${nodeId}`);
    this.executionOrder.push(nodeId);
    this.store.setNodeResult(nodeId, result);
    if (!result.control?.suppressDownstream) this.routeStandard(node, result);
  }

  protected normalizeResult(raw: any, category: string): NodeResult {
    if (raw && typeof raw === "object" && "success" in raw) {
      if (!raw.success) {
        throw new Error(raw.error || `Node execution failed: ${category}`);
      }
      return raw;
    }
    return { data: raw?.data ?? raw };
  }

  protected routeLoop(
    nodeId: string,
    result: NodeResult,
    meta?: IterMeta,
  ): void {
    if (!result || typeof result !== "object") return;
    if (result.control?.parallelDistributed) return;

    if (result.control?.loopCompleted) {
      for (const edge of this.graph.doneEdges(nodeId))
        this.routeEdge(edge, result, meta);
      return;
    }

    if (result.control?.loopIteration) {
      for (const edge of this.graph.loopBodyEdges(nodeId)) {
        this.routeEdge(edge, result, {
          ...(meta || {}),
          originLoopId: nodeId,
          iterIndex: result.control.currentIndex,
        });
      }
    }
  }

  protected routeConditional(
    node: WorkflowNode,
    result: NodeResult,
    meta?: IterMeta,
  ): void {
    for (const edge of this.graph.selectEdges(node, result))
      this.routeEdge(edge, result, meta);
  }

  protected routeStandard(
    node: WorkflowNode,
    result: NodeResult,
    meta?: IterMeta,
  ): void {
    for (const edge of this.graph.getOutgoingEdges(node.id))
      this.routeEdge(edge, result, meta);
  }

  protected handleError(nodeId: string, error: unknown): void {
    const errorMessage = (error as Error).message || "Unknown error";
    this.executionOrder.push(nodeId);
    this.failed.add(nodeId);
    this.failedNodeErrors.set(nodeId, errorMessage);
    this.store.setNodeError(nodeId, error);
    this.store.setNodeResult(nodeId, {
      success: false,
      data: null,
      error: errorMessage,
    });
    if (this.options.mode === "fail-fast") throw error;
  }

  executeOnce(item: QueueItem): void | Promise<void> {
    const node = this.graph.nodeById.get(item.nodeId);
    if (!node) return;

    try {
      if (this.options.abortSignal?.aborted)
        throw new Error("Workflow cancelled by user");

      const category = resolveCategory(node);
      const executor =
        this.nodeExecutorMap.get(node.id) ?? getNodeExecutor(category);
      if (!executor) {
        throw new Error(
          `Unsupported node category: ${category} for node type: ${node.name}`,
        );
      }

      const context = this.getExecutionContext(node.id);
      const t0 = performance.now();
      const warmupResult = context.isWarmingUp
        ? enforceWarmupPolicy(node)
        : undefined;
      const raw = warmupResult ?? executor.execute(node, item.input, context);

      if (raw instanceof Promise) {
        return raw
          .then((result) =>
            this.routeNodeResult(
              node,
              this.normalizeResult(result, category),
              t0,
              item.meta,
            ),
          )
          .catch((error) => this.handleError(node.id, error));
      }

      this.routeNodeResult(
        node,
        this.normalizeResult(raw, category),
        t0,
        item.meta,
      );
    } catch (error) {
      this.handleError(node.id, error);
    }
  }

  protected routeNodeResult(
    node: WorkflowNode,
    result: NodeResult,
    t0: number,
    meta?: IterMeta,
  ): void {
    const elapsed = performance.now() - t0;
    const prev = this.nodeTiming.get(node.id) ?? { totalMs: 0, count: 0 };
    prev.totalMs += elapsed;
    prev.count += 1;
    this.nodeTiming.set(node.id, prev);

    this.executionOrder.push(node.id);
    this.store.setNodeResult(node.id, result);

    if (result.control?.suppressDownstream) return;

    if (node.name === "Loop") {
      this.routeLoop(node.id, result, meta);
      return;
    }

    if (node.name === "If" || node.name === "Switch") {
      this.routeConditional(node, result, meta);
      return;
    }

    this.routeStandard(node, result, meta);
  }

  abstract primeEntry(nodeId: string, input: any): void;
  abstract routeEdge(edge: WorkflowEdge, payload: any, meta?: IterMeta): void;
  abstract areDependenciesSatisfied(nodeId: string): boolean;
  abstract resetForNextBar(full?: boolean): void;
}

export class StandardExecutionRuntime extends BaseExecutionRuntime {
  private readonly edgePayload = new Map<string, any>();
  private readonly enqueuedKeys = new Set<string>();

  private keyFor(item: QueueItem): string {
    const iterPart = item.meta?.originLoopId
      ? `@loop:${item.meta.originLoopId}:${item.meta.iterIndex ?? "na"}`
      : "";
    return `${item.nodeId}${iterPart}`;
  }

  override enqueue(item: QueueItem): boolean {
    const key = this.keyFor(item);
    if (this.enqueuedKeys.has(key)) return false;
    this.enqueuedKeys.add(key);
    this.queue.enqueue(item);
    return true;
  }

  override dequeue(): QueueItem | undefined {
    const item = this.queue.dequeue();
    if (!item) return undefined;
    this.enqueuedKeys.delete(this.keyFor(item));
    return item;
  }

  primeEntry(nodeId: string, input: any): void {
    for (const edge of this.graph.getIncomingEdges(nodeId)) {
      this.edgePayload.set(edge.id, input);
    }
  }

  routeEdge(edge: WorkflowEdge, payload: any, meta?: IterMeta): void {
    if (this.graph.isSubNode(edge.source)) return;
    this.edgePayload.set(edge.id, payload);

    const targetNode = this.graph.nodeById.get(edge.target);
    const skipDependencyCheck = Boolean(
      (targetNode as any)?.values?.checkDependency,
    );
    if (!skipDependencyCheck && !this.areDependenciesSatisfied(edge.target))
      return;

    this.enqueue({ nodeId: edge.target, input: payload, meta });
  }

  areDependenciesSatisfied(nodeId: string): boolean {
    const required = this.graph
      .getIncomingEdges(nodeId)
      .filter((e) => !this.graph.isSubNode(e.source));
    return (
      required.length > 0 && required.every((e) => this.edgePayload.has(e.id))
    );
  }

  override executeOnce(item: QueueItem): void | Promise<void> {
    const out = super.executeOnce(item);
    if (out instanceof Promise) {
      // Cleanup runs after async executor completion. Queue processing is sequential,
      // so downstream dependency checks cannot observe stale payloads mid-execution.
      return out.finally(() => {
        for (const e of this.graph.getIncomingEdges(item.nodeId))
          this.edgePayload.delete(e.id);
      });
    }

    for (const e of this.graph.getIncomingEdges(item.nodeId))
      this.edgePayload.delete(e.id);
  }

  resetForNextBar(full = false): void {
    this.store.clearResults();
    this.queue.clear();
    this.failed.clear();
    this.failedNodeErrors.clear();
    this.enqueuedKeys.clear();
    this.executionOrder.length = 0;
    if (full) this.edgePayload.clear();
  }
}

export class BacktestExecutionRuntime extends BaseExecutionRuntime {
  public lastStoreClearMs = 0;

  private readonly satisfiedCounts = new Map<string, number>();

  protected override routeNodeResult(
    node: WorkflowNode,
    result: NodeResult,
    t0: number,
    meta?: IterMeta,
  ): void {
    const elapsed = performance.now() - t0;
    const prev = this.nodeTiming.get(node.id) ?? { totalMs: 0, count: 0 };
    prev.totalMs += elapsed;
    prev.count += 1;
    this.nodeTiming.set(node.id, prev);

    this.executionOrder.push(node.id);
    this.store.setNodeResult(node.id, result);

    if (result.control?.suppressDownstream) return;

    if (node.name === "Loop") {
      this.routeLoop(node.id, result, meta);
      return;
    }

    if (node.name === "If" || node.name === "Switch") {
      this.routeConditional(node, result, meta);
      return;
    }

    this.routeStandard(node, result, meta);
  }

  primeEntry(_nodeId: string, _input: any): void {
    // Backtest runtime does not require pre-marking edge payloads.
  }

  routeEdge(edge: WorkflowEdge, payload: any, meta?: IterMeta): void {
    if (this.graph.isSubNode(edge.source)) return;
    this.satisfiedCounts.set(
      edge.target,
      (this.satisfiedCounts.get(edge.target) ?? 0) + 1,
    );

    const targetNode = this.graph.nodeById.get(edge.target);
    const skipDependencyCheck = Boolean(
      (targetNode as any)?.values?.checkDependency,
    );
    if (!skipDependencyCheck && !this.areDependenciesSatisfied(edge.target))
      return;

    this.enqueue({ nodeId: edge.target, input: payload, meta });
  }

  areDependenciesSatisfied(nodeId: string): boolean {
    const required = this.graph.requiredEdgeCounts.get(nodeId) ?? 0;
    return required > 0 && (this.satisfiedCounts.get(nodeId) ?? 0) >= required;
  }

  resetForNextBar(full = false): void {
    const t0 = performance.now();
    this.store.clearResults();
    this.lastStoreClearMs = performance.now() - t0;
    this.queue.clear();
    this.failed.clear();
    this.failedNodeErrors.clear();
    this.satisfiedCounts.clear();
    this.executionOrder.length = 0;
    if (full) this.execCtx = null;
  }
}
