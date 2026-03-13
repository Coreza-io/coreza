/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {
  WorkflowNode,
  WorkflowEdge,
  QueueItem,
  IterMeta,
  NodeInput,
  NodeResult,
} from "../nodes/types";
import { NodeQueueManager } from "./nodeQueueManager";
import { NodeRouter } from "./router";
import { NodeStoreV2 } from "./nodeStoreV2";
import { getNodeExecutor } from "../nodes/registry";
import { resolveReferences } from "../utils/resolveReferences";
import { preCompileAllNodes, CompiledNodeParams } from "../utils/templateCompiler";
import { DataContext, DataContextManager } from "./DataContext";
import { IndicatorStateManager } from "./indicatorStateManager";
import { performance } from "perf_hooks";

const CATEGORY_MAP: Record<string, string> = {
  If: "ControlFlow",
  Switch: "ControlFlow",
  "Edit Fields": "ControlFlow",
  Compute: "ControlFlow",
  Loop: "ControlFlow",
  Scheduler: "Utility",
  trigger: "Utility",
  Visualize: "Utility",
  webhook: "Utility",
  httprequest: "Utility",
  Gmail: "Communication",
  WhatsApp: "Communication",
  FinnHub: "DataSource",
  YahooFinance: "DataSource",
  Store: "DataSource",
  RollingWindow: "DataSource",
  LLM: "LLM",
  AIAgent: "AIAgent",
  InitializeIndicators: "Indicators",
};

interface ExecutionContext {
  nodeId: string;
  runId: string;
  workflowId: string;
  userId: string;
  getState: (key: string) => any;
  setState: (key: string, value: any) => void;
  getPersistentValue: (key: string) => Promise<any>;
  setPersistentValue: (key: string, value: any) => Promise<void>;
  resolveNodeParameters: (node: WorkflowNode, input: any) => any;
}

export class WorkflowEngine {
  private router: NodeRouter;
  private queue: NodeQueueManager;
  private store: NodeStoreV2;
  private executors: Map<string, any> = new Map();
  private edgePayload = new Map<string, any>();
  private branchOrigins = new Map<
    string,
    Map<string, { ifNodeId: string; handle: string; edgeId: string }>
  >();
  private failed = new Set<string>();
  private failedNodeErrors = new Map<string, string>();
  private enqueuedKeys = new Set<string>();
  private retryCount = new Map<string, number>();
  private MAX_RETRIES = 0;
  private mode: "best-effort" | "fail-fast";
  private abortSignal?: AbortSignal;

  // Execution tracking
  private executionOrder: string[] = [];

  // DataContext for execution-scoped RAM storage (shared by all tools)
  private dataContext: DataContext;
  private indicatorStateManager: IndicatorStateManager;
  private silent = false;
  private nodeById = new Map<string, WorkflowNode>();
  private incomingEdgesByTarget = new Map<string, WorkflowEdge[]>();
  private outgoingEdgesBySource = new Map<string, WorkflowEdge[]>();
  private _execCtx: any = null;
  private _nodeHasTemplatesCache = new Map<string, boolean>();
  private _compiledParams = new Map<string, CompiledNodeParams>();
  private nodeTiming = new Map<string, { totalMs: number; count: number }>();

  // Phase C: Pre-computed dependency counts for fast satisfaction checks
  private _requiredEdgeCounts = new Map<string, number>();
  private _satisfiedCounts = new Map<string, number>();

  constructor(
    private runId: string,
    private workflowId: string,
    private userId: string,
    private nodes: WorkflowNode[],
    private edges: WorkflowEdge[],
    mode: "best-effort" | "fail-fast" = "best-effort",
    abortSignal?: AbortSignal,
  ) {
    this.router = new NodeRouter(edges);
    // Add node type lookup to router
    (this.router as any).getSourceNodeType = (nodeId: string) => {
      const node = this.nodeById.get(nodeId);
      return node?.type;
    };
    this.queue = new NodeQueueManager();
    this.store = new NodeStoreV2(runId, nodes);
    this.mode = mode;
    this.abortSignal = abortSignal;

    // Initialize DataContext for this workflow run
    this.dataContext = DataContextManager.getInstance().getContext({
      runId,
      workflowId,
      userId,
    });
    const hasBacktestNode = this.nodes.some((node) =>
      (node.name || node.node_type || "").toLowerCase().includes("backtest"),
    );
    this.silent = hasBacktestNode;
    if (this.silent) {
      this.queue.silent = true;
      this.router.silent = true;
    }
    this.indicatorStateManager = new IndicatorStateManager(
      hasBacktestNode ? 86400 : undefined,
    );

    for (const node of this.nodes) {
      this.nodeById.set(node.id, node);
    }

    for (const edge of this.edges) {
      const incoming = this.incomingEdgesByTarget.get(edge.target);
      if (incoming) {
        incoming.push(edge);
      } else {
        this.incomingEdgesByTarget.set(edge.target, [edge]);
      }

      const outgoing = this.outgoingEdgesBySource.get(edge.source);
      if (outgoing) {
        outgoing.push(edge);
      } else {
        this.outgoingEdgesBySource.set(edge.source, [edge]);
      }
    }

    this.buildBranchOrigins();
    // Pre-compile all node templates once at workflow load time
    this._compiledParams = preCompileAllNodes(this.nodes);

    // Phase C: Pre-compute required edge counts per node (excluding sub-nodes)
    for (const node of this.nodes) {
      const incoming = this.incomingEdgesByTarget.get(node.id) ?? [];
      const requiredCount = incoming.filter((e) => !this.isSubNode(e.source)).length;
      this._requiredEdgeCounts.set(node.id, requiredCount);
    }

    if (!this.silent) {
      console.log(`📦 WorkflowEngine: DataContext initialized for run ${runId}, ${this._compiledParams.size} nodes pre-compiled`);
    }
  }

  /**
   * Get the DataContext for this workflow run
   * Tools and executors can use this to share data efficiently
   */
  getDataContext(): DataContext {
    return this.dataContext;
  }

  setIndicatorStateManager(manager: IndicatorStateManager): void {
    this.indicatorStateManager = manager;
  }

  reset(newRunId: string, abortSignal?: AbortSignal): void {
    DataContextManager.getInstance().destroyContext(this.runId);

    this.runId = newRunId;
    this.abortSignal = abortSignal;
    this.edgePayload.clear();
    this.failed.clear();
    this.failedNodeErrors.clear();
    this.enqueuedKeys.clear();
    this.retryCount.clear();
    this.executionOrder = [];
    this.nodeTiming.clear();
    this.queue = new NodeQueueManager();
    if (this.silent) {
      this.queue.silent = true;
    }
    this.store = new NodeStoreV2(newRunId, this.nodes);
    // NOTE: indicatorStateManager is intentionally NOT reset.
    // For LiveStrategyRunner: preserves indicator state across ticks (desired).
    // For EnginePool: warm indicator cache across runs (acceptable, keyed by nodeId).
    this.dataContext = DataContextManager.getInstance().getContext({
      runId: newRunId,
      workflowId: this.workflowId,
      userId: this.userId,
    });
    this._execCtx = null;
  }

  resetLight(newRunId: string, abortSignal?: AbortSignal): void {
    this.runId = newRunId;
    this.abortSignal = abortSignal;
    this.edgePayload.clear();
    this.failed.clear();
    this.failedNodeErrors.clear();
    this.enqueuedKeys.clear();
    this.retryCount.clear();
    this.executionOrder = [];
    this.queue = new NodeQueueManager();
    if (this.silent) {
      this.queue.silent = true;
    }
    this.store = new NodeStoreV2(newRunId, this.nodes);
    this._execCtx = null;
  }

  /**
   * Ultra-lightweight reset for backtest bar-to-bar transitions.
   * Reuses all existing objects — only clears per-bar state.
   * Pinned results (BacktestInit) survive across bars.
   */
  resetForNextBar(): void {
    this.store.clearResults();
    this.edgePayload.clear();
    this.enqueuedKeys.clear();
    this.executionOrder.length = 0;
    this.queue.clear();
    this._satisfiedCounts.clear();
  }

  /**
   * Pin results that persist across bars (e.g. BacktestInit output).
   * Call once after construction.
   */
  pinResults(results: Record<string, any>): void {
    this.store.pinResults(results);
  }

  /**
   * Pre-populate the store with node results so that template expressions
   * like {{ $('BacktestInit').json.backtest_id }} can resolve even when
   * the referenced node is not part of the current subgraph.
   */
  preloadResults(results: Record<string, any>): void {
    for (const [nodeId, result] of Object.entries(results)) {
      this.store.setNodeResult(nodeId, result);
    }
  }

  /**
   * Execute the workflow starting from multiple entry nodes simultaneously.
   * Pre-marks all incoming edge payloads for the entry nodes so dependency
   * checks pass, then enqueues all of them before running the processing loop.
   *
   * Used by BacktestRunner where the strategy subgraph has no trigger/backtest
   * nodes and needs explicit entry points.
   */
  async executeFromEntries(
    input: any,
    entryNodeIds: string[],
  ): Promise<{
    success: boolean;
    result?: any;
    executionOrder?: string[];
    error?: string;
  }> {
    const workflowStartTime = Date.now();
    try {
      this.MAX_RETRIES = this.nodes.length * 2;

      // Pre-mark incoming edges and enqueue all entry nodes
      for (const entryNodeId of entryNodeIds) {
        const incomingEdges = this.getIncomingEdges(entryNodeId);
        for (const edge of incomingEdges) {
          this.markEdgePayload(edge.id, input);
        }
        this.enqueue({ nodeId: entryNodeId, input });
      }

      // Process queue until empty
      while (this.queue.length > 0) {
        if (this.abortSignal?.aborted) {
          throw new Error("Workflow cancelled by user");
        }
        const item = this.dequeue();
        if (!item) break;
        await this.executeOnce(item);
      }

      const hasFailedNodes = this.failed.size > 0;
      if (hasFailedNodes) {
        const firstFailedNodeId = Array.from(this.failed)[0];
        const errorMessage =
          this.failedNodeErrors.get(firstFailedNodeId) ||
          `Workflow completed with failures`;
        return {
          success: false,
          error: errorMessage,
          result: this.store.getAllResults(),
          executionOrder: this.executionOrder,
        };
      }

      return {
        success: true,
        result: this.store.getAllResults(),
        executionOrder: this.executionOrder,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - workflowStartTime;
      const formattedExecutionTime =
        this.formatExecutionDuration(executionTimeMs);
      console.error(
        `❌ executeFromEntries failed after ${formattedExecutionTime}:`,
        error,
      );
      return {
        success: false,
        error: (error as Error).message,
        executionOrder: this.executionOrder,
      };
    }
  }

  private getExecutionOrderForResponse(): string[] | undefined {
    return this.executionOrder.length > 0 ? this.executionOrder : undefined;
  }

  // Deep resolve helper for resolving template expressions recursively
  private resolveDeep(
    val: any,
    input: any,
    allNodeData: Record<string, any>,
  ): any {
    if (typeof val === "string" && val.includes("{{")) {
      const resolved = resolveReferences(val, input, allNodeData, this.nodes);
      // If resolveReferences returned non-string, return it directly
      return resolved;
    }
    if (Array.isArray(val)) {
      return val.map((item) => this.resolveDeep(item, input, allNodeData));
    }
    if (val !== null && typeof val === "object") {
      return Object.fromEntries(
        Object.entries(val).map(([k, v]) => [
          k,
          this.resolveDeep(v, input, allNodeData),
        ]),
      );
    }
    return val; // number, boolean, null, undefined
  }

  private resolveNodeParameters(node: WorkflowNode, input: any): any {
    // Fast path: use pre-compiled accessors when available
    const compiled = this._compiledParams.get(node.id);
    if (compiled) {
      if (!compiled.hasTemplates) return compiled.staticParams!;
      if (compiled.resolve) {
        const allNodeData = this.store.getAllResults();
        const resolved = compiled.resolve(allNodeData, input);
        // If some entries had fallback, resolve them with resolveDeep
        if (compiled.fallbackKeys && compiled.fallbackKeys.length > 0) {
          for (const key of compiled.fallbackKeys) {
            resolved[key] = this.resolveDeep(resolved[key], input, allNodeData);
          }
        }
        return resolved;
      }
    }

    // Fallback: original resolution path
    const nodeParams = node.values || {};
    const resolvedParams: any = {};

    // Fast path: skip deep resolution for static node parameters
    if (!this.nodeHasTemplates(node.id, nodeParams)) {
      for (const [key, value] of Object.entries(nodeParams)) {
        if (key === "credential_id") continue;
        resolvedParams[key] = value;
      }
      return resolvedParams;
    }

    // Get all node data for cross-references
    const allNodeData = this.store.getAllResults();

    // Resolve all node.values parameters with reference resolution
    for (const [key, value] of Object.entries(nodeParams)) {
      // Skip operational fields that are handled separately
      if (key === "credential_id") continue;
      // Deeply resolve strings/arrays/objects
      resolvedParams[key] = this.resolveDeep(value, input, allNodeData);
    }

    return resolvedParams;
  }

  private nodeHasTemplates(nodeId: string, params: any): boolean {
    if (this._nodeHasTemplatesCache.has(nodeId)) {
      return this._nodeHasTemplatesCache.get(nodeId)!;
    }

    const hasTemplates = this.containsTemplates(params);
    this._nodeHasTemplatesCache.set(nodeId, hasTemplates);
    return hasTemplates;
  }

  private containsTemplates(value: any): boolean {
    if (typeof value === "string") return value.includes("{{");
    if (Array.isArray(value))
      return value.some((v) => this.containsTemplates(v));
    if (value && typeof value === "object") {
      return Object.values(value).some((v) => this.containsTemplates(v));
    }
    return false;
  }

  private getExecutionContext(nodeId: string): any {
    if (!this._execCtx) {
      const ctx: any = {
        user_id: this.userId,
        userId: this.userId,
        runId: this.runId,
        workflowId: this.workflowId,
        nodes: this.nodes,
        edges: this.edges,
        resolveNodeParameters: this.resolveNodeParameters.bind(this),
        getAllNodeResults: () => this.store.getAllResults(),
        dataContext: this.dataContext,
        indicatorStateManager: this.indicatorStateManager,
        abortSignal: this.abortSignal,
        checkCancellation: this.checkCancellation.bind(this),
        silent: this.silent,
        nodeId,
      };

      ctx.getState = (key: string) => this.store.getNodeState(ctx.nodeId, key);
      ctx.setState = (key: string, value: any) =>
        this.store.setNodeState(ctx.nodeId, key, value);
      this._execCtx = ctx;
    }

    this._execCtx.nodeId = nodeId;
    return this._execCtx;
  }

  registerExecutor(category: string, executor: any) {
    this.executors.set(category, executor);
  }

  // -----------------------------
  // Queue + graph helpers
  // -----------------------------

  private keyFor(item: QueueItem): string {
    const iterPart = item.meta?.originLoopId
      ? `@loop:${item.meta.originLoopId}:${item.meta.iterIndex ?? "na"}`
      : "";
    return `${item.nodeId}${iterPart}`;
  }

  private enqueue(item: QueueItem) {
    const key = this.keyFor(item);
    if (this.enqueuedKeys.has(key)) return false;
    this.queue.enqueue(item);
    this.enqueuedKeys.add(key);
    return true;
  }

  private dequeue(): QueueItem | undefined {
    const item = this.queue.dequeue();
    if (!item) return undefined;
    const key = this.keyFor(item);
    this.enqueuedKeys.delete(key);
    return item;
  }

  private getIncomingEdges = (targetId: string) =>
    this.incomingEdgesByTarget.get(targetId) ?? [];

  private getOutgoingEdges = (sourceId: string) =>
    this.outgoingEdgesBySource.get(sourceId) ?? [];

  private isLoopNode = (nodeId: string) => {
    const n = this.nodeById.get(nodeId);
    return n?.name === "Loop";
  };

  private isSubNode = (nodeId: string) => {
    const n = this.nodeById.get(nodeId);
    return (n as any)?.node_type === "sub";
  };

  private selectEdges(node: WorkflowNode, result: any): WorkflowEdge[] {
    const outgoingEdges = this.getOutgoingEdges(node.id);
    if (node.name === "If" || node.name === "Switch") {
      const resultData = result?.data;
      let chosen: string[] = ["default", ""];

      if (typeof resultData === "boolean") {
        chosen = [resultData ? "true" : "false"];
      } else if (typeof resultData === "string") {
        chosen = [resultData];
      } else if (
        resultData &&
        typeof resultData === "object" &&
        ("true" in resultData || "false" in resultData)
      ) {
        chosen = Object.entries(resultData)
          .filter(([, value]) => !!value)
          .map(([key]) => key);
      }

      const allowed = new Set(chosen);
      return outgoingEdges.filter((edge) =>
        allowed.has(edge.sourceHandle ?? ""),
      );
    }

    return outgoingEdges;
  }

  private loopBodyEdges(loopId: string): WorkflowEdge[] {
    return this.getOutgoingEdges(loopId).filter(
      (edge) => !edge.sourceHandle || edge.sourceHandle === "loop",
    );
  }

  private doneEdges(loopId: string): WorkflowEdge[] {
    return this.getOutgoingEdges(loopId).filter(
      (edge) => edge.sourceHandle === "done",
    );
  }

  private areDependenciesSatisfied(nodeId: string): boolean {
    const allIncoming = this.getIncomingEdges(nodeId);
    const required = allIncoming.filter((e) => !this.isSubNode(e.source));

    if (required.length === 0) return false;

    return required.every((e) => this.edgePayload.has(e.id));
  }

  private getBranchOrigin(edge: WorkflowEdge, targetNodeId: string) {
    return this.branchOrigins.get(targetNodeId)?.get(edge.id);
  }

  private buildBranchOrigins(): void {
    const conditionalMap = new Map<string, Record<string, string[]>>();

    for (const edge of this.edges) {
      const sourceNode = this.nodeById.get(edge.source);
      const isBranchingNode =
        sourceNode?.name === "If" || sourceNode?.name === "Switch";
      if (!isBranchingNode || !edge.sourceHandle) continue;

      const entry = conditionalMap.get(edge.source) ?? {};
      (entry[edge.sourceHandle] ??= []).push(edge.target);
      conditionalMap.set(edge.source, entry);
    }

    this.branchOrigins.clear();

    for (const [ifNodeId, branchMap] of conditionalMap.entries()) {
      const handleReachable = new Map<string, Set<string>>();

      for (const [handle, targets] of Object.entries(branchMap)) {
        const visited = new Set<string>();
        const stack = [...targets];

        while (stack.length > 0) {
          const current = stack.pop()!;
          if (visited.has(current)) continue;
          visited.add(current);

          for (const out of this.getOutgoingEdges(current)) {
            stack.push(out.target);
          }
        }

        handleReachable.set(handle, visited);
      }

      const nodeToHandles = new Map<string, Set<string>>();
      for (const [handle, nodes] of handleReachable.entries()) {
        for (const nodeId of nodes) {
          const handles = nodeToHandles.get(nodeId) ?? new Set<string>();
          handles.add(handle);
          nodeToHandles.set(nodeId, handles);
        }
      }

      for (const [targetNodeId, handles] of nodeToHandles.entries()) {
        if (handles.size < 2) continue;

        for (const incoming of this.getIncomingEdges(targetNodeId)) {
          const matchingHandles: string[] = [];

          for (const handle of handles) {
            const reachable = handleReachable.get(handle);
            const directFromBranchNode =
              incoming.source === ifNodeId && incoming.sourceHandle === handle;

            if (directFromBranchNode || reachable?.has(incoming.source)) {
              matchingHandles.push(handle);
            }
          }

          if (matchingHandles.length !== 1) continue;

          const targetOrigins =
            this.branchOrigins.get(targetNodeId) ??
            new Map<
              string,
              { ifNodeId: string; handle: string; edgeId: string }
            >();

          targetOrigins.set(incoming.id, {
            ifNodeId,
            handle: matchingHandles[0],
            edgeId: incoming.id,
          });

          this.branchOrigins.set(targetNodeId, targetOrigins);
        }
      }
    }
  }

  private markEdgePayload(edgeId: string, payload: any) {
    this.edgePayload.set(edgeId, payload);
  }

  private clearIncomingEdgePayloads(nodeId: string) {
    for (const e of this.getIncomingEdges(nodeId))
      this.edgePayload.delete(e.id);
  }

  private async routeEdge(
    edge: WorkflowEdge,
    payload: any,
    meta?: IterMeta,
  ): Promise<void> {
    if (this.isSubNode(edge.source)) return;

    this.markEdgePayload(edge.id, payload);

    const targetNode = this.nodeById.get(edge.target);
    const skipDependencyCheck = Boolean(
      (targetNode as any)?.values?.checkDependency,
    );

    if (!skipDependencyCheck) {
      if (!this.areDependenciesSatisfied(edge.target)) return;
    }

    this.enqueue({
      nodeId: edge.target,
      input: payload,
      meta,
    });
  }

  private formatExecutionDuration(durationMs: number): string {
    const totalCentiseconds = Math.floor(durationMs / 10);
    const centiseconds = totalCentiseconds % 100;
    const totalSeconds = Math.floor(totalCentiseconds / 100);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);

    return [hours, minutes, seconds, centiseconds]
      .map((value) => value.toString().padStart(2, "0"))
      .join(":");
  }

  async execute(
    initialInput?: any,
    startNodeId?: string,
  ): Promise<{
    success: boolean;
    result?: any;
    executionOrder?: string[];
    error?: string;
  }> {
    const workflowStartTime = Date.now();
    try {
      console.log(
        `🚀 [WORKFLOW] Starting V2 workflow execution for run ${this.runId}${
          startNodeId ? ` from node ${startNodeId}` : ""
        }`,
      );
      this.MAX_RETRIES = this.nodes.length * 2;

      await this.run(initialInput, startNodeId);

      const hasFailedNodes = this.failed.size > 0;
      const failedNodeIds = Array.from(this.failed);

      if (hasFailedNodes) {
        const executionTimeMs = Date.now() - workflowStartTime;
        const formattedExecutionTime =
          this.formatExecutionDuration(executionTimeMs);
        console.log(
          `⚠️ Workflow completed with ${
            failedNodeIds.length
          } failed node(s): ${failedNodeIds.join(", ")} (Execution time: ${formattedExecutionTime})`,
        );
      } else {
        const executionTimeMs = Date.now() - workflowStartTime;
        const formattedExecutionTime =
          this.formatExecutionDuration(executionTimeMs);
        console.log(
          `✅ Workflow execution completed successfully (Execution time: ${formattedExecutionTime})`,
        );
      }

      if (this.silent && this.indicatorStateManager) {
        await this.indicatorStateManager.flushToRedis();
      }

      // Log DataContext stats before cleanup
      const ctxStats = this.dataContext.getStats();
      console.log(
        `📊 DataContext stats: ${ctxStats.entryCount} entries, ` +
          `${(ctxStats.totalSizeBytes / 1024 / 1024).toFixed(2)}MB used`,
      );

      // Cleanup DataContext on successful completion
      DataContextManager.getInstance().destroyContext(this.runId);

      if (hasFailedNodes) {
        const firstFailedNodeId = failedNodeIds[0];
        const errorMessage =
          this.failedNodeErrors.get(firstFailedNodeId) ||
          `Workflow completed with failures in nodes: ${failedNodeIds.join(
            ", ",
          )}`;

        return {
          success: false,
          error: errorMessage,
          result: this.store.getAllResults(),
          executionOrder: this.executionOrder,
        };
      }

      return {
        success: true,
        result: this.store.getAllResults(),
        executionOrder: this.executionOrder,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - workflowStartTime;
      const formattedExecutionTime =
        this.formatExecutionDuration(executionTimeMs);
      console.error(
        `❌ Workflow execution failed after ${formattedExecutionTime}:`,
        error,
      );
      const message = (error as Error).message;

      // Cleanup DataContext on failure too
      DataContextManager.getInstance().destroyContext(this.runId);

      return {
        success: false,
        error: message,
        executionOrder: this.executionOrder,
      };
    }
  }

  async run(initialInput: any = [], startNodeId?: string): Promise<void> {
    let startedFromSpecificNode = false;

    // Pre-populate store from parent workflow context if provided (parallel loop child jobs)
    // This allows child jobs to reference ANY upstream node via {{ $('NodeName').json.* }}
    if (
      initialInput?.$parentStore &&
      typeof initialInput.$parentStore === "object"
    ) {
      const parentStore = initialInput.$parentStore;
      const nodeCount = Object.keys(parentStore).length;
      if (nodeCount > 0) {
        console.log(
          `📥 Pre-populating store with ${nodeCount} parent node outputs`,
        );
        for (const [nodeId, result] of Object.entries(parentStore)) {
          this.store.setNodeResult(nodeId, result);
        }
      }
    }

    // If startNodeId is provided (loop continuation or parallel loop item), start from that specific node
    if (startNodeId) {
      const startNode = this.nodeById.get(startNodeId);
      if (startNode) {
        console.log(
          `🔗 Starting execution from specific node: ${startNodeId} (${
            startNode.name || startNode.node_type
          })`,
        );

        // Pre-mark all incoming edge payloads so dependency check passes
        // This simulates what would have happened if the parent node (Loop) had executed and routed to us
        const incomingEdges = this.getIncomingEdges(startNodeId);
        for (const edge of incomingEdges) {
          console.log(
            `📌 Pre-marking edge payload: ${edge.source} → ${edge.target}`,
          );
          this.markEdgePayload(edge.id, initialInput);
        }

        this.enqueue({ nodeId: startNodeId, input: initialInput });
        startedFromSpecificNode = true;
      } else {
        console.warn(
          `⚠️ Start node ${startNodeId} not found in nodes list, falling back to entry nodes`,
        );
      }
    }

    // Only find entry nodes if we didn't successfully start from a specific node
    if (!startedFromSpecificNode) {
      const entryNodes = this.nodes.filter(
        (n) =>
          (n.node_type === "trigger" || n.node_type === "backtest") &&
          (this.incomingEdgesByTarget.get(n.id)?.length ?? 0) === 0,
      );

      for (const node of entryNodes) {
        if (node.node_type === "trigger") {
          console.log(
            `🟡 Skipping re-run for ${node.name || node.node_type} node`,
          );
          const edges = this.selectEdges(node, initialInput);
          for (const edge of edges) {
            this.store.setNodeResult(node.id, initialInput);
            await this.routeEdge(edge, initialInput);
          }
        } else {
          this.enqueue({ nodeId: node.id, input: initialInput });
        }
      }
    }

    // Process queue until empty
    while (this.queue.length > 0) {
      // Check if job was cancelled via abort signal
      if (this.abortSignal?.aborted) {
        throw new Error("Workflow cancelled by user");
      }

      const item = this.dequeue();
      if (!item) break;
      await this.executeOnce(item);
    }
  }

  /**
   * Check if the workflow has been cancelled.
   * Uses AbortSignal from BullMQ (immediate, event-driven) as single source of truth.
   * No Redis polling needed - BullMQ's worker.cancelJob() triggers abort signal immediately.
   */
  checkCancellation(): boolean {
    return this.abortSignal?.aborted ?? false;
  }

  private async executeOnce(item: QueueItem): Promise<void> {
    const { nodeId, input, meta } = item;
    const node = this.nodeById.get(nodeId);
    if (!node) return;

    // // FE-style retry guard when dependencies are missing
    // const incoming = this.getIncomingEdges(nodeId);
    // if (incoming.length > 0 && !this.areDependenciesSatisfied(nodeId)) {
    //   const tries = this.retryCount.get(nodeId) || 0;
    //   if (tries >= this.MAX_RETRIES) {
    //     this.failed.add(nodeId);
    //     this.store.setNodeError(
    //       nodeId,
    //       new Error(
    //         `Dependency not satisfied after ${this.MAX_RETRIES} retries`,
    //       ),
    //     );
    //     return;
    //   }
    //   this.retryCount.set(nodeId, tries + 1);
    //   this.enqueue(item);
    //   return;
    // }

    // // Track execution timing
    // const startedAt = new Date().toISOString();
    // const startTime = Date.now();

    try {
      // Check if workflow was cancelled before executing this node
      // AbortSignal check is synchronous - no Redis polling needed
      if (this.checkCancellation()) {
        throw new Error("Workflow cancelled by user");
      }

      const executionContext = this.getExecutionContext(nodeId);
      const t0 = performance.now();
      const result = await this.executeNode(node, input, executionContext);
      const elapsed = performance.now() - t0;
      const prev = this.nodeTiming.get(nodeId) ?? { totalMs: 0, count: 0 };
      prev.totalMs += elapsed;
      prev.count += 1;
      this.nodeTiming.set(nodeId, prev);
      if (!this.silent) {
        console.log(`✅ Node ${nodeId} result:`, result);
      }

      this.executionOrder.push(nodeId);

      this.store.setNodeResult(nodeId, result);

      if (node.name === "Loop" && result && typeof result === "object") {
        // Unified control-based loop handling
        if (result.control?.parallelDistributed) {
          // Parallel mode - aggregator will handle continuation
          console.log(
            `🔄 Loop ${nodeId}: Parallel execution distributed to BullMQ workers`,
          );
          console.log(
            `   Items: ${result.control.itemCount}, MaxConcurrency: ${result.control.maxConcurrency}`,
          );
          return;
        }

        if (result.control?.loopCompleted) {
          // Sequential mode - loop completed, route to done edges
          const doneEdges = this.doneEdges(nodeId);
          for (const edge of doneEdges) {
            await this.routeEdge(edge, result, meta);
          }
        } else if (result.control?.loopIteration) {
          // Sequential mode - loop iteration, route to loop body edges
          const loopEdges = this.loopBodyEdges(nodeId);
          for (const edge of loopEdges) {
            const iterMeta: IterMeta = {
              ...(meta || {}),
              originLoopId: nodeId,
              iterIndex: result.control.currentIndex,
            };
            await this.routeEdge(edge, result, iterMeta);
          }
        }
        return; // don't clear loop node payloads
      }

      const edges = this.selectEdges(node, result);
      if (!this.silent) {
        const targetSummary =
          edges.length > 0
            ? edges.map((edge) => edge.target).join(",")
            : "none";

        console.log(`🎯 Routing from ${nodeId} to ${targetSummary}`);
      }

      if (meta?.originLoopId) {
        const loopNodeId = meta.originLoopId;
        const loopNode = this.nodeById.get(loopNodeId);
        const hasActiveEdgeToLoop = edges.some((e) => e.target === loopNodeId);
        if (loopNode?.name === "Loop" && hasActiveEdgeToLoop) {
          const currentResults =
            this.store.getNodeState(loopNodeId, "aggregatedResults") || [];
          currentResults.push(result);
          this.store.setNodeState(
            loopNodeId,
            "aggregatedResults",
            currentResults,
          );
        }
      }

      for (const edge of edges) {
        await this.routeEdge(edge, result, meta);
      }

      this.clearIncomingEdgePayloads(nodeId);
    } catch (error) {
      const errorMessage = (error as Error).message || "";
      const isCancellation =
        errorMessage.toLowerCase().includes("cancelled") ||
        errorMessage.toLowerCase().includes("deactivated") ||
        this.abortSignal?.aborted;

      console.error(
        `${isCancellation ? "🛑" : "❌"} Node ${nodeId} ${
          isCancellation ? "cancelled" : "failed"
        }:`,
        error,
      );

      // Record failed execution
      // const completedAt = new Date().toISOString();
      // const durationMs = Date.now() - startTime;

      this.executionOrder.push(nodeId);

      this.failed.add(nodeId);
      this.failedNodeErrors.set(nodeId, errorMessage);
      this.store.setNodeError(nodeId, error);

      // ALWAYS rethrow cancellation errors - they should never be swallowed
      if (isCancellation) {
        throw error;
      }

      if (meta?.originLoopId) {
        const originLoopId = meta.originLoopId;
        const loopNode = this.nodeById.get(originLoopId);
        const config = loopNode?.values || {};
        if (config.continueOnError) {
          const currentResults =
            this.store.getNodeState(originLoopId, "aggregatedResults") || [];
          currentResults.push({ error: (error as any).message });
          this.store.setNodeState(
            originLoopId,
            "aggregatedResults",
            currentResults,
          );
          this.enqueue({ nodeId: originLoopId, input: {}, meta: {} });
          return;
        }
      }

      if (this.mode === "fail-fast") {
        throw error;
      }
      // best-effort: swallow non-cancellation errors only
    }
  }

  async executeNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    if (!this.silent) {
      console.log(`🔧 Executing node ${node.id} (${node.name})`);
    }

    const nodeName = node.name ?? "";

    // Map node categories for compatibility
    const category = CATEGORY_MAP[nodeName] ?? node.category;

    // Use custom executor if registered, otherwise get from registry
    let executor = this.executors.get(category);
    if (!executor) {
      executor = getNodeExecutor(category);
    }

    if (!executor) {
      throw new Error(
        `Unsupported node category: ${category} for node type: ${node.name}`,
      );
    }

    // Execute node with enhanced context
    const result = await executor.execute(node, input, context);

    if (result && typeof result === "object" && "success" in result) {
      if (!result.success) {
        throw new Error(result.error || `Node execution failed: ${category}`);
      }
      return result;
    }

    // For simple results, wrap in structure to maintain consistency
    return { data: result?.data ?? result };
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
      //const node = this.nodeById.get(id);
      const label = id;
      result[label] = {
        avgMs: +(timing.totalMs / timing.count).toFixed(3),
        totalMs: +timing.totalMs.toFixed(3),
        count: timing.count,
      };
    }

    return result;
  }
}

/**
 * Factory function to execute a workflow
 */
export type ExecutionOptions = {
  mode?: "best-effort" | "fail-fast";
  initialInput?: any;
  /** Start execution from a specific node (for loop continuation) */
  startNodeId?: string;
  /** Abort signal for cancellation support */
  abortSignal?: AbortSignal;
};

export async function executeWorkflow(
  runId: string,
  workflowId: string,
  userId: string,
  nodes: any[],
  edges: any[],
  opts?: ExecutionOptions,
): Promise<{ success: boolean; result?: any; error?: string }> {
  const workflowEngine = new WorkflowEngine(
    runId,
    workflowId,
    userId,
    nodes,
    edges,
    opts?.mode,
    opts?.abortSignal,
  );
  return await workflowEngine.execute(opts?.initialInput, opts?.startNodeId);
}
