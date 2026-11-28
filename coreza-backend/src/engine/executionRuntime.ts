import { readNodeResult, isFailedResult, NodeResultError, resultFailure, type ResultMeta } from "../contracts/nodeResult";
import { createHash } from "crypto";
import { isPersistentVariableEdit, type VariableValue } from "../variables/contract";
import { canContinueNodeError, continuedNodeError } from "../nodes/errorContinuation";
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
import type { OrderedBranches } from "./branchOrder";
import { GraphRuntime } from "./graphRuntime";
import { IndicatorStateManager } from "./indicatorStateManager";
import { NodeQueueManager } from "./nodeQueueManager";
import { NodeStoreV2 } from "./nodeStoreV2";
import { ParameterResolver } from "./parameterResolver";
import { ExecutionMode, NodeExecutionContext, type NodeResultObserver } from "./types";
import { runPreparedBacktest } from "../backtest/runPreparedBacktest";

export type RuntimeOptions = {
  executionId: string;
  reportingExecutionId?: string;
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
  getVariables?: () => Readonly<Record<string, unknown>> | undefined;
};

type ExecutionContextExtras = Partial<
  Pick<NodeExecutionContext, "multiBarContext" | "runId" | "isWarmingUp" | "variableEventId" | "liveTiming">
>;

function withVariableInputs(result: NodeResult, inputs?: ResultMeta["variableInputs"]): NodeResult {
  return inputs
    ? { ...result, meta: { ...result.meta, variableInputs: inputs } }
    : result;
}

export abstract class BaseExecutionRuntime {
  nodeResultObserver?: NodeResultObserver;
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
  private readonly orderedBranches?: OrderedBranches;
  protected readonly orderedLoopJoinArrivals = new Map<string, Set<string>>();

  constructor(
    protected readonly graph: GraphRuntime,
    protected readonly store: NodeStoreV2,
    protected readonly resolver: ParameterResolver,
    protected readonly options: RuntimeOptions,
  ) {
    this.allowedExecutableNodeIds = options.allowedExecutableNodeIds
      ? new Set(options.allowedExecutableNodeIds)
      : undefined;
    this.orderedBranches = this.allowedExecutableNodeIds ? undefined : graph.orderedBranches;
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

  enqueueEntry(nodeId: string, input: unknown): void {
    this.primeEntry(nodeId, input);
    this.enqueue({ nodeId, input });
  }

  protected assertNodeAllowed(nodeId: string, phase: "enqueue" | "execute" | "route"): void {
    if (this.allowedExecutableNodeIds && !this.allowedExecutableNodeIds.has(nodeId)) {
      throw new Error(`Scoped execution invariant failed during ${phase}: ${nodeId}`);
    }
  }

  dequeue(): QueueItem | undefined {
    return this.queue.dequeue(this.orderedBranches?.priorities);
  }

  protected routeOrderedLoopJoin(edge: WorkflowEdge, payload: any, meta?: IterMeta): boolean {
    if (!meta?.originLoopId || !this.orderedBranches?.joinIds.has(edge.target)) return false;

    // Each iteration needs a fresh arrival on every incoming branch edge.
    const key = JSON.stringify([edge.target, meta.originLoopId, meta.iterIndex, meta.itemIndex]);
    const arrivals = this.orderedLoopJoinArrivals.get(key) ?? new Set<string>();
    arrivals.add(edge.id);
    if (arrivals.size === this.graph.requiredEdgeCounts.get(edge.target)) {
      this.orderedLoopJoinArrivals.delete(key);
      this.enqueue({ nodeId: edge.target, input: payload, meta });
    } else {
      this.orderedLoopJoinArrivals.set(key, arrivals);
    }
    return true;
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
    if (!this.execCtx) {
      const ctx: NodeExecutionContext = {
        user_id: this.options.userId,
        userId: this.options.userId,
        executionId: this.options.executionId,
        reportingExecutionId: this.options.reportingExecutionId,
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
            ctx.variables,
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
    Object.assign(this.executionContextExtras, extras);
    if (this.execCtx) {
      Object.assign(this.execCtx, extras);
    }
  }

  protected normalizeResult(raw: any, category: string): NodeResult {
    const result = readNodeResult(raw);
    if (isFailedResult(result)) {
      this.recordOwnedResults(result);
      throw new NodeResultError(result);
    }
    return result;
  }

  protected recordOwnedResults(result: NodeResult, ownerId?: string): void {
    const owned = result.control?.ownedNodeResults;
    if (!owned) return;
    const order = result.control?.ownedExecutionOrder ?? Object.keys(owned);
    for (const nodeId of order) {
      if (nodeId === ownerId || owned[nodeId] == null) continue;
      this.store.setNodeResult(nodeId, owned[nodeId]);
      if (!this.executionOrder.includes(nodeId)) this.executionOrder.push(nodeId);
    }
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

  protected handleError(nodeId: string, error: unknown, meta?: IterMeta, startedAt?: number, variableInputs?: ResultMeta["variableInputs"]): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const node = this.graph.nodeById.get(nodeId);
    const name = node?.name ?? node?.type;
    const values = node?.values ?? {};
    const continued = !this.options.abortSignal?.aborted && !!node && !isPersistentVariableEdit(node) && canContinueNodeError(name, values);
    const continuedResult = continued ? continuedNodeError(name, values, errorMessage) : undefined;
    const continuation = continuedResult && error instanceof NodeResultError
      ? { ...error.result, control: { ...error.result.control, ...continuedResult.control } }
      : continuedResult;
    this.executionOrder.push(nodeId);
    if (!continued) this.failed.add(nodeId);
    this.failedNodeErrors.set(nodeId, errorMessage);
    this.store.setNodeError(nodeId, error instanceof Error ? error : new Error(errorMessage));
    const result = continuation ? readNodeResult(continuation)
      : error instanceof NodeResultError ? error.result : resultFailure(errorMessage);
    const recorded = withVariableInputs(result, variableInputs);
    this.store.setNodeResult(nodeId, recorded);
    this.nodeResultObserver?.(nodeId, recorded, startedAt === undefined ? 0 : performance.now() - startedAt);
    if (continuation) {
      const outgoing = name === "Loop" ? this.graph.doneEdges(nodeId)
        : this.graph.getOutgoingEdges(nodeId).filter(edge => !continuation.control?.sourceHandle || edge.sourceHandle === continuation.control?.sourceHandle);
      for (const edge of outgoing) this.routeEdge(edge, readNodeResult(continuation), meta);
      return;
    }
    if (this.options.mode === "fail-fast" || isPersistentVariableEdit(this.graph.nodeById.get(nodeId))) throw error;
  }

  executeOnce(item: QueueItem): void | Promise<void> {
    this.assertNodeAllowed(item.nodeId, "execute");
    const node = this.graph.nodeById.get(item.nodeId);
    if (!node) return;

    let startedAt: number | undefined;
    let variableInputs: Record<string, VariableValue> | undefined;
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
      if (context.variables && (this.options.executionMode !== "backtest" || this.nodeResultObserver)) {
        // The expression evaluator reads named variables through own descriptors.
        // Record those reads for this invocation using its immutable input values.
        context.variables = new Proxy(context.variables, {
          getOwnPropertyDescriptor(target, key) {
            const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
            const value = descriptor?.value;
            if (typeof key === "string" && (value === null || typeof value === "string" ||
                typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))) {
              (variableInputs ??= Object.create(null))[key] = value;
            }
            return descriptor;
          },
        });
      }
      const t0 = performance.now();
      startedAt = t0;
      const raw = executor.execute(node, item.input, context);

      if (raw instanceof Promise) {
        const pending = node.name === "BacktestInit"
          ? raw.then((result) => runPreparedBacktest(result, context.abortSignal))
          : raw;
        return pending
          .then((result) =>
            this.routeNodeResult(
              node,
              this.normalizeResult(result, category),
              t0,
              item.meta,
              variableInputs,
            ),
          )
          .catch((error) => this.handleError(node.id, error, item.meta, startedAt, variableInputs));
      }

      this.routeNodeResult(
        node,
        this.normalizeResult(raw, category),
        t0,
        item.meta,
        variableInputs,
      );
    } catch (error) {
      this.handleError(node.id, error, item.meta, startedAt, variableInputs);
    }
  }

  protected routeNodeResult(
    node: WorkflowNode,
    result: NodeResult,
    t0: number,
    meta?: IterMeta,
    variableInputs?: ResultMeta["variableInputs"],
  ): void {
    const elapsed = performance.now() - t0;
    const prev = this.nodeTiming.get(node.id) ?? { totalMs: 0, count: 0 };
    prev.totalMs += elapsed;
    prev.count += 1;
    this.nodeTiming.set(node.id, prev);

    this.executionOrder.push(node.id);
    this.store.setNodeResult(node.id, withVariableInputs(result, variableInputs));

    this.recordOwnedResults(result, node.id);
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
  publishResult(nodeId: string, result: NodeResult): void {
    const node = this.graph.nodeById.get(nodeId);
    if (!node) throw new Error(`Unknown node: ${nodeId}`);
    this.assertNodeAllowed(nodeId, "execute");
    this.routeNodeResult(node, result, performance.now());
  }
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
    const item = super.dequeue();
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
    if (this.routeOrderedLoopJoin(edge, payload, meta)) return;
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
    const dependencies = this.graph.dependenciesByTarget.get(nodeId);
    if (!dependencies?.requiredCount) return false;

    return dependencies.independentEdgeIds.every(id => this.edgePayload.has(id)) &&
      dependencies.branchGroups.every(group =>
        group.some(id => this.edgePayload.has(id)));
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
    this.orderedLoopJoinArrivals.clear();
    this.executionOrder.length = 0;
    if (full) this.edgePayload.clear();
  }
}

type BacktestLoopMeta = IterMeta & { feedbackToken?: symbol };

interface BacktestLoopActivation {
  startupMeta?: IterMeta;
  feedback?: { iterIndex: number; token: symbol };
}

export class BacktestExecutionRuntime extends BaseExecutionRuntime {
  public lastStoreClearMs = 0;

  private readonly satisfiedCounts = new Map<string, number>();
  private readonly loopStartupArrivals = new Map<string, Set<string>>();
  private readonly pendingLoopEntries = new Map<string, QueueItem>();
  private readonly activeLoops = new Map<string, BacktestLoopActivation>();

  override enqueueEntry(nodeId: string, input: unknown): void {
    const node = this.graph.nodeById.get(nodeId);
    if (node?.name === "Loop" && !node.values?.checkDependency &&
        this.graph.getLoopScheduling(nodeId).startup.requiredCount > 0) {
      // BacktestInit's edge supplies the bar payload but is outside the strategy graph.
      this.assertNodeAllowed(nodeId, "enqueue");
      this.pendingLoopEntries.set(nodeId, { nodeId, input });
      return;
    }
    super.enqueueEntry(nodeId, input);
  }

  override enqueue(item: QueueItem): boolean {
    if (this.graph.isLoopNode(item.nodeId)) {
      if (this.activeLoops.has(item.nodeId)) return false;
      this.loopStartupArrivals.delete(item.nodeId);
      this.pendingLoopEntries.delete(item.nodeId);
      this.activeLoops.set(item.nodeId, { startupMeta: item.meta });
    }
    return super.enqueue(item);
  }

  protected override routeNodeResult(
    node: WorkflowNode,
    result: NodeResult,
    t0: number,
    meta?: IterMeta,
    variableInputs?: ResultMeta["variableInputs"],
  ): void {
    const elapsed = performance.now() - t0;
    if (!this.executionContextExtras.isWarmingUp) {
      const prev = this.nodeTiming.get(node.id) ?? { totalMs: 0, count: 0 };
      prev.totalMs += elapsed;
      prev.count += 1;
      this.nodeTiming.set(node.id, prev);
    }

    this.executionOrder.push(node.id);
    const recorded = withVariableInputs(result, variableInputs);
    this.store.setNodeResult(node.id, recorded);
    this.nodeResultObserver?.(node.id, recorded, elapsed);

    this.recordOwnedResults(result, node.id);
    if (result.control?.suppressRouting) return;

    if (node.name === "Loop") {
      const active = this.activeLoops.get(node.id);
      const control = result.control;
      if (active && control?.loopIteration && !control.loopCompleted &&
          !control.parallelDistributed && control.currentIndex !== undefined) {
        // Iteration indices start over when a Loop is activated again in the same bar.
        const token = Symbol();
        active.feedback = { iterIndex: control.currentIndex, token };
        const iterationMeta: BacktestLoopMeta = { ...meta, feedbackToken: token };
        this.routeLoop(node.id, result, iterationMeta);
        return;
      }
      this.activeLoops.delete(node.id);
      this.routeLoop(node.id, result, meta);
      return;
    }

    if (node.name === "If" || node.name === "Switch") {
      this.routeConditional(node, result, meta);
      return;
    }

    this.routeStandard(node, result, meta);
  }

  protected override handleError(nodeId: string, error: unknown, meta?: IterMeta, startedAt?: number): void {
    if (this.activeLoops.delete(nodeId)) this.store.clearNodeState(nodeId);
    super.handleError(nodeId, error, meta, startedAt);
  }

  primeEntry(_nodeId: string, _input: any): void {
    // Backtest runtime does not require pre-marking edge payloads.
  }

  routeEdge(edge: WorkflowEdge, payload: any, meta?: BacktestLoopMeta): void {
    if (this.graph.isSubNode(edge.source) || this.graph.isSubNode(edge.target)) return;
    this.assertNodeAllowed(edge.source, "route");
    this.assertNodeAllowed(edge.target, "route");
    const targetNode = this.graph.nodeById.get(edge.target);
    if (targetNode?.name === "Loop") {
      this.routeLoopInput(edge, payload, meta, Boolean(targetNode.values?.checkDependency));
      return;
    }
    if (this.routeOrderedLoopJoin(edge, payload, meta)) return;
    this.satisfiedCounts.set(
      edge.target,
      (this.satisfiedCounts.get(edge.target) ?? 0) + 1,
    );

    const skipDependencyCheck = Boolean(
      (targetNode as any)?.values?.checkDependency,
    );
    if (!skipDependencyCheck && !this.areDependenciesSatisfied(edge.target))
      return;

    this.enqueue({ nodeId: edge.target, input: payload, meta });
  }

  private routeLoopInput(edge: WorkflowEdge, payload: any, meta: BacktestLoopMeta | undefined, skipDependencyCheck: boolean): void {
    const { feedbackEdgeIds } = this.graph.getLoopScheduling(edge.target);
    const active = this.activeLoops.get(edge.target);
    if (feedbackEdgeIds.has(edge.id)) {
      const feedback = active?.feedback;
      if (active && feedback && meta?.originLoopId === edge.target &&
          meta.iterIndex === feedback.iterIndex && meta.feedbackToken === feedback.token) {
        active.feedback = undefined;
        // Preserve the caller's iteration metadata for the eventual done edge.
        super.enqueue({ nodeId: edge.target, input: payload, meta: active.startupMeta });
      }
      return;
    }
    if (active) return;

    const arrivals = this.loopStartupArrivals.get(edge.target) ?? new Set<string>();
    this.loopStartupArrivals.set(edge.target, arrivals);
    arrivals.add(edge.id);
    if (skipDependencyCheck || this.areDependenciesSatisfied(edge.target)) {
      this.enqueue(this.pendingLoopEntries.get(edge.target) ?? { nodeId: edge.target, input: payload, meta });
    }
  }

  areDependenciesSatisfied(nodeId: string): boolean {
    if (this.graph.isLoopNode(nodeId)) {
      const arrivals = this.loopStartupArrivals.get(nodeId);
      const { startup } = this.graph.getLoopScheduling(nodeId);
      return !!arrivals && startup.requiredCount > 0 &&
        startup.independentEdgeIds.every(id => arrivals.has(id)) &&
        startup.branchGroups.every(group => group.some(id => arrivals.has(id)));
    }
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
    this.loopStartupArrivals.clear();
    this.pendingLoopEntries.clear();
    for (const nodeId of this.activeLoops.keys()) this.store.clearNodeState(nodeId);
    this.activeLoops.clear();
    this.orderedLoopJoinArrivals.clear();
    this.executionOrder.length = 0;
    if (full) this.execCtx = null;
  }
}

