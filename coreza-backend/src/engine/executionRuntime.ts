import { createHash } from "crypto";
import { isPersistentVariableEdit } from "../variables/contract";
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
  allowedExecutableNodeIds?: readonly string[];
  executionScope?: NodeExecutionContext["executionScope"];
  commitVariables?: (changes: readonly import("../variables/contract").VariableChange[], token: string) => void | Promise<void>;
  assertAdmission?: () => void;
  getVariables?: () => Readonly<Record<string, unknown>> | undefined;
};

type ExecutionContextExtras = Partial<
  Pick<NodeExecutionContext, "multiBarContext" | "runId" | "isWarmingUp" | "variableEventId">
>;

export abstract class BaseExecutionRuntime {
  private readonly variableInvocations = new Map<string, number>();
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
  protected readonly pinnedNodeIds = new Set<string>();
  private readonly allowedExecutableNodeIds?: ReadonlySet<string>;

  constructor(
    protected readonly graph: GraphRuntime,
    protected readonly store: NodeStoreV2,
    protected readonly resolver: ParameterResolver,
    protected readonly options: RuntimeOptions,
  ) {
    this.allowedExecutableNodeIds = options.allowedExecutableNodeIds
      ? new Set(options.allowedExecutableNodeIds)
      : undefined;
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
  resetVariableInvocations(): void { this.variableInvocations.clear(); }
  releaseVariables(): void { if (this.execCtx) this.execCtx.variables = undefined; }

  enqueue(item: QueueItem): boolean {
    this.assertNodeAllowed(item.nodeId, "enqueue");
    this.queue.enqueue(item);
    return true;
  }

  protected assertNodeAllowed(nodeId: string, phase: "enqueue" | "execute" | "route"): void {
    if (this.allowedExecutableNodeIds && !this.allowedExecutableNodeIds.has(nodeId)) {
      throw new Error(`Scoped execution invariant failed during ${phase}: ${nodeId}`);
    }
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

  setPinnedNodeIds(nodeIds: readonly string[]): void {
    nodeIds.forEach((nodeId) => this.pinnedNodeIds.add(nodeId));
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
    this.options.assertAdmission?.();
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
            this.options.getVariables?.(),
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
        executionScope: this.options.executionScope,
        isWarmingUp: false,
        variables: this.options.getVariables?.(),
        commitVariables: (changes) => {
          const invocation = this.variableInvocations.get(ctx.nodeId) ?? 0;
          this.variableInvocations.set(ctx.nodeId, invocation + 1);
          const event = ctx.variableEventId ?? ctx.runId ?? ctx.executionId;
          const token = createHash("sha256").update(JSON.stringify([event, ctx.nodeId, invocation])).digest("hex");
          if (!this.options.commitVariables) throw new Error("Persistent variable context unavailable");
          return this.options.commitVariables(changes, token);
        },
        getState: (key: string) => this.store.getNodeState(ctx.nodeId, key),
        setState: (key: string, value: any) =>
          this.store.setNodeState(ctx.nodeId, key, value),
      };
      this.execCtx = ctx;
    }

    this.execCtx.nodeId = nodeId;
    this.execCtx.variables = this.options.getVariables?.();
    Object.assign(this.execCtx, this.executionContextExtras);
    return this.execCtx;
  }

  setExecutionContextExtras(extras: ExecutionContextExtras): void {
    this.executionContextExtras = extras;
    if (this.execCtx) {
      Object.assign(this.execCtx, extras);
    }
  }

  protected normalizeResult(raw: any, category: string): NodeResult {
    if (raw && typeof raw === "object" && "success" in raw) {
      if (!raw.success) {
        if (raw.control?.ownedNodeResults) {
          const order = raw.control.ownedExecutionOrder ?? Object.keys(raw.control.ownedNodeResults);
          for (const nodeId of order) {
            const result = raw.control.ownedNodeResults[nodeId];
            if (result === undefined) continue;
            this.store.setNodeResult(nodeId, result);
            if (!this.executionOrder.includes(nodeId)) this.executionOrder.push(nodeId);
          }
        }
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
    if (this.options.mode === "fail-fast" || isPersistentVariableEdit(this.graph.nodeById.get(nodeId))) throw error;
  }

  executeOnce(item: QueueItem): void | Promise<void> {
    this.assertNodeAllowed(item.nodeId, "execute");
    const node = this.graph.nodeById.get(item.nodeId);
    if (!node) return;

    try {
      if (this.options.abortSignal?.aborted)
        throw new Error("Workflow cancelled by user");

      if (this.pinnedNodeIds.has(node.id)) {
        const pinned = this.store.getNodeResult(node.id);
        if (!pinned) throw new Error(`Pinned result missing for node: ${node.id}`);
        this.routeNodeResult(node, pinned, performance.now(), item.meta);
        return;
      }

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

    if (result.control?.ownedNodeResults) {
      const order = result.control.ownedExecutionOrder ?? Object.keys(result.control.ownedNodeResults);
      for (const nodeId of order) {
        const ownedResult = result.control.ownedNodeResults[nodeId];
        if (ownedResult === undefined || nodeId === node.id) continue;
        this.store.setNodeResult(nodeId, ownedResult);
        if (!this.executionOrder.includes(nodeId)) this.executionOrder.push(nodeId);
      }
    }
    if (result.control?.suppressRouting) return;

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
    this.assertNodeAllowed(item.nodeId, "enqueue");
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
    if (this.graph.isSubNode(edge.source) || this.graph.isSubNode(edge.target)) return;
    this.assertNodeAllowed(edge.source, "route");
    this.assertNodeAllowed(edge.target, "route");
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
    if (required.length === 0) return false;

    const branchOrigins = this.graph.branchOrigins.get(nodeId);
    if (!branchOrigins?.size) return required.every((edge) => this.edgePayload.has(edge.id));

    const branchGroups = new Map<string, WorkflowEdge[]>();
    const independent: WorkflowEdge[] = [];
    for (const edge of required) {
      const origin = branchOrigins.get(edge.id);
      if (!origin) {
        independent.push(edge);
        continue;
      }
      const group = branchGroups.get(origin.ifNodeId) ?? [];
      group.push(edge);
      branchGroups.set(origin.ifNodeId, group);
    }

    return independent.every((edge) => this.edgePayload.has(edge.id)) &&
      [...branchGroups.values()].every((group) =>
        group.some((edge) => this.edgePayload.has(edge.id)));
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
    this.resetVariableInvocations();
    this.failed.clear();
    this.failedNodeErrors.clear();
    this.store.clearResults();
    this.queue.clear();
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

    if (result.control?.suppressRouting) return;

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
    if (this.graph.isSubNode(edge.source) || this.graph.isSubNode(edge.target)) return;
    this.assertNodeAllowed(edge.source, "route");
    this.assertNodeAllowed(edge.target, "route");
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
    this.resetVariableInvocations();
    this.failed.clear();
    this.failedNodeErrors.clear();
    const t0 = performance.now();
    this.store.clearResults();
    this.lastStoreClearMs = performance.now() - t0;
    this.queue.clear();
    this.satisfiedCounts.clear();
    this.executionOrder.length = 0;
    if (full) this.execCtx = null;
  }
}
