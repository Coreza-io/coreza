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
import { normalizeOutput } from "../utils/normalizeOutput";
import { DataContext, DataContextManager } from "./DataContext";

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

// Node execution log for tracking detailed execution data
export interface NodeExecutionLog {
  nodeId: string;
  nodeName: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: "success" | "failed" | "skipped";
  input: any;
  output: any;
  itemCount: number;
  error?: string;
}

export class WorkflowEngine {
  private router: NodeRouter;
  private queue: NodeQueueManager;
  private store: NodeStoreV2;
  private executors: Map<string, any> = new Map();
  private edgePayload = new Map<string, any>();
  private executed = new Set<string>();
  private failed = new Set<string>();
  private enqueuedKeys = new Set<string>();
  private retryCount = new Map<string, number>();
  private MAX_RETRIES = 0;
  private mode: "best-effort" | "fail-fast";
  private abortSignal?: AbortSignal;

  // Execution tracking for detailed logs
  private nodeExecutions: NodeExecutionLog[] = [];
  private executionOrder: string[] = [];

  // DataContext for execution-scoped RAM storage (shared by all tools)
  private dataContext: DataContext;

  constructor(
    private runId: string,
    private workflowId: string,
    private userId: string,
    private nodes: WorkflowNode[],
    private edges: WorkflowEdge[],
    mode: "best-effort" | "fail-fast" = "best-effort",
    abortSignal?: AbortSignal
  ) {
    this.router = new NodeRouter(edges);
    // Add node type lookup to router
    (this.router as any).getSourceNodeType = (nodeId: string) => {
      const node = this.nodes.find((n) => n.id === nodeId);
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
    console.log(`📦 WorkflowEngine: DataContext initialized for run ${runId}`);
  }

  /**
   * Get the DataContext for this workflow run
   * Tools and executors can use this to share data efficiently
   */
  getDataContext(): DataContext {
    return this.dataContext;
  }

  // Deep resolve helper for resolving template expressions recursively
  private resolveDeep(
    val: any,
    input: any,
    allNodeData: Record<string, any>
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
        ])
      );
    }
    return val; // number, boolean, null, undefined
  }

  private resolveNodeParameters(node: WorkflowNode, input: any): any {
    const nodeParams = node.values || {};
    const resolvedParams: any = {};

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
    this.edges.filter((e) => e.target === targetId);

  private isLoopNode = (nodeId: string) => {
    const n = this.nodes.find((x) => x.id === nodeId);
    return n?.name === "Loop";
  };

  private isSubNode = (nodeId: string) => {
    const n = this.nodes.find((x) => x.id === nodeId);
    return (n as any)?.node_type === "sub";
  };

  private areDependenciesSatisfied(nodeId: string): boolean {
    if (this.isLoopNode(nodeId)) {
      const loopNode = this.nodes.find((n) => n.id === nodeId);
      const loopWaits = Boolean((loopNode as any)?.values?.loopWaits);
      if (!loopWaits) return true;
    }

    // Filter out edges from "sub" nodes (support nodes like tools/chat models)
    const allIncoming = this.getIncomingEdges(nodeId);
    const required = allIncoming.filter((e) => !this.isSubNode(e.source));

    if (required.length === 0) return false;
    return required.every((e) => this.edgePayload.has(e.id));
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
    meta?: IterMeta
  ): Promise<void> {
    // Sub nodes don't produce workflow output, they just provide config
    if (this.isSubNode(edge.source)) {
      console.log(`⏭️ Skipping edge routing from sub node ${edge.source}`);
      return;
    }

    this.markEdgePayload(edge.id, payload);
    if (!this.areDependenciesSatisfied(edge.target)) return;

    const target = this.nodes.find((n) => n.id === edge.target);
    this.enqueue({ nodeId: edge.target, input: payload, meta });
  }

  async execute(
    initialInput?: any,
    startNodeId?: string
  ): Promise<{
    success: boolean;
    result?: any;
    nodeExecutions?: NodeExecutionLog[];
    executionOrder?: string[];
    error?: string;
  }> {
    try {
      console.log(
        `🚀 [WORKFLOW] Starting V2 workflow execution for run ${this.runId}${
          startNodeId ? ` from node ${startNodeId}` : ""
        }`
      );
      this.MAX_RETRIES = this.nodes.length * 2;

      await this.run(initialInput, startNodeId);

      console.log(`✅ Workflow execution completed successfully`);

      // Log DataContext stats before cleanup
      const ctxStats = this.dataContext.getStats();
      console.log(
        `📊 DataContext stats: ${ctxStats.entryCount} entries, ` +
          `${(ctxStats.totalSizeBytes / 1024 / 1024).toFixed(2)}MB used`
      );

      // Cleanup DataContext on successful completion
      DataContextManager.getInstance().destroyContext(this.runId);

      return {
        success: true,
        result: this.store.getAllResults(),
        nodeExecutions: this.nodeExecutions,
        executionOrder: this.executionOrder,
      };
    } catch (error) {
      console.error("❌ Workflow execution failed:", error);
      const message = (error as Error).message;

      // Cleanup DataContext on failure too
      DataContextManager.getInstance().destroyContext(this.runId);

      return {
        success: false,
        error: message,
        nodeExecutions: this.nodeExecutions,
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
          `📥 Pre-populating store with ${nodeCount} parent node outputs`
        );
        for (const [nodeId, result] of Object.entries(parentStore)) {
          this.store.setNodeResult(nodeId, result);
        }
      }
    }

    // If startNodeId is provided (loop continuation or parallel loop item), start from that specific node
    if (startNodeId) {
      const startNode = this.nodes.find((n) => n.id === startNodeId);
      if (startNode) {
        console.log(
          `🔗 Starting execution from specific node: ${startNodeId} (${
            startNode.name || startNode.node_type
          })`
        );

        // Pre-mark all incoming edge payloads so dependency check passes
        // This simulates what would have happened if the parent node (Loop) had executed and routed to us
        const incomingEdges = this.getIncomingEdges(startNodeId);
        for (const edge of incomingEdges) {
          console.log(
            `📌 Pre-marking edge payload: ${edge.source} → ${edge.target}`
          );
          this.markEdgePayload(edge.id, initialInput);
        }

        this.enqueue({ nodeId: startNodeId, input: initialInput });
        startedFromSpecificNode = true;
      } else {
        console.warn(
          `⚠️ Start node ${startNodeId} not found in nodes list, falling back to entry nodes`
        );
      }
    }

    // Only find entry nodes if we didn't successfully start from a specific node
    if (!startedFromSpecificNode) {
      const entryNodes = this.nodes.filter(
        (n) =>
          (n.node_type === "trigger" || n.node_type === "backtest") &&
          !this.edges.some((e) => e.target === n.id)
      );

      for (const node of entryNodes) {
        if (node.node_type === "trigger") {
          console.log(
            `🟡 Skipping re-run for ${node.name || node.node_type} node`
          );
          const edges = this.router.select(node, initialInput);
          for (const edge of edges) {
            this.store.setNodeResult(node.id, initialInput);
            this.executed.add(node.id);
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
        throw new Error('Workflow cancelled by user');
      }
      
      const item = this.dequeue();
      if (!item) break;
      await this.executeOnce(item);
    }
  }

  /**
   * Check if the workflow has been cancelled via Redis flag.
   * This allows long-running operations to detect cancellation even if
   * the abort signal hasn't propagated yet.
   */
  async checkCancellation(): Promise<boolean> {
    if (this.abortSignal?.aborted) return true;
    
    try {
      const { getRedisCache } = await import('../config/redis');
      const redis = getRedisCache();
      const isCancelled = await redis.get(`workflow:${this.workflowId}:cancelled`);
      return !!isCancelled;
    } catch {
      return false;
    }
  }

  private async executeOnce(item: QueueItem): Promise<void> {
    const { nodeId, input, meta } = item;
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // FE-style retry guard when dependencies are missing
    const incoming = this.getIncomingEdges(nodeId);
    if (incoming.length > 0 && !this.areDependenciesSatisfied(nodeId)) {
      const tries = this.retryCount.get(nodeId) || 0;
      if (tries >= this.MAX_RETRIES) {
        this.failed.add(nodeId);
        this.store.setNodeError(
          nodeId,
          new Error(
            `Dependency not satisfied after ${this.MAX_RETRIES} retries`
          )
        );
        return;
      }
      this.retryCount.set(nodeId, tries + 1);
      this.enqueue(item);
      return;
    }

    // Track execution timing
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    try {
      // Check if workflow was cancelled before executing this node
      const wasCancelled = await this.checkCancellation();
      if (wasCancelled) {
        throw new Error('Workflow cancelled by user');
      }

      // Create execution context with all necessary information
      const executionContext = {
        user_id: this.userId,
        userId: this.userId,
        runId: this.runId,
        workflowId: this.workflowId,
        nodes: this.nodes,
        edges: this.edges,
        resolveNodeParameters: this.resolveNodeParameters.bind(this),
        getState: (key: string) => this.store.getNodeState(nodeId, key),
        setState: (key: string, value: any) =>
          this.store.setNodeState(nodeId, key, value),
        // Allow parallel loop to capture and share parent workflow context with child jobs
        getAllNodeResults: () => this.store.getAllResults(),
        // DataContext for execution-scoped RAM storage (shared by all tools)
        dataContext: this.dataContext,
        // Abort signal for cancellation detection
        abortSignal: this.abortSignal,
        // Function for executors to check cancellation
        checkCancellation: this.checkCancellation.bind(this),
      };

      const result = await this.executeNode(node, input, executionContext);
      console.log(`✅ Node ${nodeId} result:`, result);

      // Record successful execution
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      const normalizedOutput = normalizeOutput(result, {
        nodeId,
        nodeName: node.name || nodeId,
        startTime: startTime,
        category: node.category,
      });

      const itemCount = Array.isArray(normalizedOutput.data)
        ? normalizedOutput.data.length
        : normalizedOutput.data !== null && normalizedOutput.data !== undefined
        ? 1
        : 0;

      this.nodeExecutions.push({
        nodeId,
        nodeName: node.name || nodeId,
        startedAt,
        completedAt,
        durationMs,
        status: normalizedOutput.success ? "success" : "failed",
        input,
        output: normalizedOutput,
        itemCount,
        error: normalizedOutput.error,
      });
      this.executionOrder.push(nodeId);

      this.store.setNodeResult(nodeId, result);
      this.executed.add(nodeId);

      if (node.name === "Loop" && result && typeof result === "object") {
        // Unified control-based loop handling
        if (result.control?.parallelDistributed) {
          // Parallel mode - aggregator will handle continuation
          console.log(
            `🔄 Loop ${nodeId}: Parallel execution distributed to BullMQ workers`
          );
          console.log(
            `   Items: ${result.control.itemCount}, MaxConcurrency: ${result.control.maxConcurrency}`
          );
          return;
        }

        if (result.control?.loopCompleted) {
          // Sequential mode - loop completed, route to done edges
          const doneEdges = this.router.doneEdges(nodeId);
          for (const edge of doneEdges) {
            await this.routeEdge(edge, result, meta);
          }
        } else if (result.control?.loopIteration) {
          // Sequential mode - loop iteration, route to loop body edges
          const loopEdges = this.router.loopBodyEdges(nodeId);
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

      const edges = this.router.select(node, result);
      const targetSummary =
        edges.length > 0 ? edges.map((edge) => edge.target).join(",") : "none";
      console.log(`🎯 Routing from ${nodeId} to ${targetSummary}`);

      if (meta?.originLoopId) {
        const loopNodeId = meta.originLoopId;
        const loopNode = this.nodes.find((n) => n.id === loopNodeId);
        const hasActiveEdgeToLoop = edges.some((e) => e.target === loopNodeId);
        if (loopNode?.name === "Loop" && hasActiveEdgeToLoop) {
          const currentResults =
            this.store.getNodeState(loopNodeId, "aggregatedResults") || [];
          currentResults.push(result);
          this.store.setNodeState(
            loopNodeId,
            "aggregatedResults",
            currentResults
          );
        }
      }

      for (const edge of edges) {
        await this.routeEdge(edge, result, meta);
      }

      this.clearIncomingEdgePayloads(nodeId);
    } catch (error) {
      const errorMessage = (error as Error).message || '';
      const isCancellation = errorMessage.toLowerCase().includes('cancelled') || 
                             errorMessage.toLowerCase().includes('deactivated') ||
                             this.abortSignal?.aborted;
      
      console.error(`${isCancellation ? '🛑' : '❌'} Node ${nodeId} ${isCancellation ? 'cancelled' : 'failed'}:`, error);

      // Record failed execution
      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      const normalizedError = normalizeOutput(
        {
          success: false,
          error: errorMessage,
        },
        {
          nodeId,
          nodeName: node.name || nodeId,
          startTime: startTime,
          category: node.category,
        }
      );

      this.nodeExecutions.push({
        nodeId,
        nodeName: node.name || nodeId,
        startedAt,
        completedAt,
        durationMs,
        status: "failed",
        input,
        output: normalizedError,
        itemCount: 0,
        error: errorMessage,
      });
      this.executionOrder.push(nodeId);

      this.failed.add(nodeId);
      this.store.setNodeError(nodeId, error);

      // ALWAYS rethrow cancellation errors - they should never be swallowed
      if (isCancellation) {
        throw error;
      }

      if (meta?.originLoopId) {
        const originLoopId = meta.originLoopId;
        const loopNode = this.nodes.find((n) => n.id === originLoopId);
        const config = loopNode?.values || {};
        if (config.continueOnError) {
          const currentResults =
            this.store.getNodeState(originLoopId, "aggregatedResults") || [];
          currentResults.push({ error: (error as any).message });
          this.store.setNodeState(
            originLoopId,
            "aggregatedResults",
            currentResults
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
    context?: any
  ): Promise<NodeResult> {
    console.log(`🔧 Executing node ${node.id} (${node.name})`);

    const nodeName = node.name ?? "";

    // Map node categories for compatibility - include AIAgent
    let category = node.category;
    if (
      nodeName === "If" ||
      nodeName === "Switch" ||
      nodeName === "Edit Fields" ||
      nodeName === "Compute" ||
      nodeName === "Loop"
    ) {
      category = "ControlFlow";
    } else if (
      ["Scheduler", "trigger", "Visualize", "webhook", "httprequest"].includes(
        nodeName
      )
    ) {
      category = "Utility";
    } else if (["Gmail", "WhatsApp"].includes(nodeName)) {
      category = "Communication";
    } else if (["FinnHub", "YahooFinance", "Store"].includes(nodeName)) {
      category = "DataSource";
    } else if (nodeName === "LLM") {
      category = "LLM";
    } else if (nodeName === "AIAgent") {
      category = "AIAgent"; // AIAgent
    }

    // Pass nodes and edges to context for AIAgent to access tool nodes
    const enhancedContext = {
      ...context,
      nodes: this.nodes,
      edges: this.edges,
    };

    // Use custom executor if registered, otherwise get from registry
    let executor = this.executors.get(category);
    if (!executor) {
      executor = getNodeExecutor(category);
    }

    if (!executor) {
      throw new Error(
        `Unsupported node category: ${category} for node type: ${node.name}`
      );
    }

    // Execute node with enhanced context
    const result = await executor.execute(node, input, enhancedContext);

    if (result && typeof result === "object" && "success" in result) {
      if (!result.success) {
        throw new Error(result.error || `Node execution failed: ${category}`);
      }
      // Remove fields only useful for error
      const { success, error, ...rest } = result;

      // Return everything else exactly as provided
      return { success, error, ...rest };
    }

    // For simple results, wrap in structure to maintain consistency
    return { data: result?.data ?? result };
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
  opts?: ExecutionOptions
): Promise<{ success: boolean; result?: any; error?: string }> {
  const workflowEngine = new WorkflowEngine(
    runId,
    workflowId,
    userId,
    nodes,
    edges,
    opts?.mode,
    opts?.abortSignal
  );
  return await workflowEngine.execute(opts?.initialInput, opts?.startNodeId);
}
