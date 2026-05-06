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

import { Node, Edge } from "@xyflow/react";
import ExecutionContext from "./executionContext";

export interface ExecutorContext {
  nodes: Node[];
  edges: Edge[];
  setNodes: (update: (nodes: Node[]) => Node[]) => void;
  setEdges: (update: (edges: Edge[]) => Edge[]) => void;
  setExecutingNode: (nodeId: string | null) => void;
  toast: (params: any) => void;
  executionStore: ExecutionContext;
  executeNode?: (
    nodeId: string,
    executed: Set<string>,
    explicitlyTriggered?: boolean,
  ) => Promise<any>;
}

export interface ExecutionMetrics {
  startTime: number;
  nodeTimings: Map<string, number>;
  totalNodes: number;
  failedNodes: Set<string>;
  completedNodes: Set<string>;
}

export interface NodeExecutionDetail {
  nodeId: string;
  executedSet: Set<string>;
  allNodes: Node[];
  allEdges: Edge[];
  explicitlyTriggered?: boolean;
  loopItem?: any;
  loopIndex?: number;
  onSuccess?: (result?: any) => void;
  onError?: (error: any) => void;
}

export class WorkflowExecutor {
  private nodeStore: ExecutionContext;
  private isAutoExecuting = false;
  private conditionalMap = new Map<string, Record<string, string[]>>();
  private branchOrigins = new Map<
    string,
    Map<string, { ifNodeId: string; handle: string; edgeId: string }>
  >();
  private edgePayload = new Map<string, any>();

  private getIncomingEdges = (targetId: string) =>
    this.context.edges.filter((e) => e.target === targetId);

  private markEdgePayload(edgeId: string, payload: any) {
    this.edgePayload.set(edgeId, payload);
  }

  private clearIncomingEdgePayloads(nodeId: string) {
    for (const e of this.getIncomingEdges(nodeId))
      this.edgePayload.delete(e.id);
  }

  private isBranchNodeId(id: string) {
    const n = this.context.nodes.find((x) => x.id === id);
    const name = (n?.data?.definition as any)?.name;
    return name === "If" || name === "Switch";
  }

  private isLoopNodeId(id: string) {
    const n = this.context.nodes.find((x) => x.id === id);
    const name = (n?.data?.definition as any)?.name;
    return name === "Loop";
  }

  private isSubNode(id: string) {
    const n = this.context.nodes.find((x) => x.id === id);
    const nodeType = (n?.data?.definition as any)?.node_type;
    const isTool = (n?.data as any)?.values?.__isTool === true;
    return nodeType === "sub" || isTool;
  }

  private isStreamingNode(nodeId: string): boolean {
    const node = this.context.nodes.find((n) => n.id === nodeId);
    const definition = node?.data?.definition as any;
    return (
      definition?.executionMode === "streaming" ||
      definition?.executionMode === "webhook_listening"
    );
  }

  private areDependenciesSatisfied(
    nodeId: string,
    executed: Set<string>,
    failed: Set<string>,
  ): boolean {
    if (this.isLoopNodeId(nodeId)) {
      const n = this.context.nodes.find((x) => x.id === nodeId);
      const loopWaits: boolean = Boolean(n?.data?.loopWaits);
      if (!loopWaits) return true;
    }

    // Filter out edges from "sub" nodes (support nodes like tools/chat models)
    const allIncoming = this.getIncomingEdges(nodeId);
    const requiredEdges = allIncoming.filter((e) => !this.isSubNode(e.source));

    if (requiredEdges.length === 0) return false;

    const node = this.context.nodes.find((n) => n.id === nodeId);
    const skipDependencyCheck = Boolean(
      (node?.data?.values as any)?.checkDependency,
    );

    if (skipDependencyCheck) return true;

    const branchGroups = new Map<string, Edge[]>();
    const independentEdges: Edge[] = [];

    for (const edge of requiredEdges) {
      const origin = this.getBranchOrigin(edge, nodeId);
      if (!origin) {
        independentEdges.push(edge);
        continue;
      }

      const key = `${origin.ifNodeId}::${nodeId}`;
      const grouped = branchGroups.get(key) ?? [];
      grouped.push(edge);
      branchGroups.set(key, grouped);
    }

    const hasIndependentEdges = independentEdges.length > 0;
    const hasBranchGroups = branchGroups.size > 0;

    const independentSatisfied = hasIndependentEdges
      ? independentEdges.every((e) => this.edgePayload.has(e.id))
      : true;

    // Branch groups always use ANY-of semantics since only one branch can fire.
    const branchSatisfied = hasBranchGroups
      ? Array.from(branchGroups.values()).every((group) =>
          group.some((e) => this.edgePayload.has(e.id)),
        )
      : true;

    return independentSatisfied && branchSatisfied;
  }

  private getBranchOrigin(edge: Edge, targetNodeId: string) {
    return this.branchOrigins.get(targetNodeId)?.get(edge.id);
  }

  constructor(private context: ExecutorContext) {
    this.context.executeNode = this.executeNode.bind(this);
    this.nodeStore = context.executionStore;
    this.preCalculateConditionalBranches();
  }

  /**
   * Pre-calculate conditional branches for optimization (only for actual branching nodes)
   */
  private preCalculateConditionalBranches(): void {
    this.conditionalMap.clear();
    this.branchOrigins.clear();

    // Build a map: nodeId → { handle1: [targetA, targetB], handle2: [targetC], … }
    this.context.edges.forEach((edge) => {
      const sourceNode = this.context.nodes.find((n) => n.id === edge.source);
      const nodeType = (sourceNode?.data?.definition as any)?.name;
      const isBranchingNode = ["If", "Switch"].includes(nodeType);
      if (!edge.sourceHandle || !isBranchingNode) return;

      // get—or initialize—the per-node entry
      const entry: Record<string, string[]> =
        this.conditionalMap.get(edge.source) ?? {};

      // accumulate multiple targets per handle
      (entry[edge.sourceHandle] ??= []).push(edge.target);

      this.conditionalMap.set(edge.source, entry);
    });

    console.log(
      `🗺️ [WORKFLOW EXECUTOR] Built conditional map for ${this.conditionalMap.size} branching nodes:`,
      Array.from(this.conditionalMap.entries()),
    );

    this.buildBranchOrigins();
  }

  private buildBranchOrigins(): void {
    for (const [ifNodeId, branchMap] of this.conditionalMap.entries()) {
      const handleReachable = new Map<string, Set<string>>();

      for (const [handle, targets] of Object.entries(branchMap)) {
        const visited = new Set<string>();
        const stack = [...targets];
        while (stack.length > 0) {
          const current = stack.pop()!;
          if (visited.has(current)) continue;
          visited.add(current);

          for (const out of this.context.edges) {
            if (out.source === current) stack.push(out.target);
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
            this.branchOrigins.get(targetNodeId) ?? new Map<string, any>();
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
  /**
   * Execute conditional chain starting from a specific node
   */
  async executeConditionalChain(
    startNodeId: string,
    completedNodes: Set<string>,
  ): Promise<void> {
    console.log(`🎯 Starting conditional chain from: ${startNodeId}`);

    return new Promise<void>((resolve) => {
      const event = new CustomEvent("auto-execute-node", {
        detail: {
          nodeId: startNodeId,
          executedSet: completedNodes,
          allNodes: this.context.nodes,
          allEdges: this.context.edges,
          onSuccess: async (result?: any) => {
            console.log(`✅ Node ${startNodeId} succeeded with result`, result);
            completedNodes.add(startNodeId);
            const currentNode = this.context.nodes.find(
              (n) => n.id === startNodeId,
            );

            const isBranchNode = this.conditionalMap.has(startNodeId);
            if (isBranchNode) {
              await this.handleBranchNodeResult(
                startNodeId,
                result,
                completedNodes,
              );
            } else {
              await this.executeDownstreamNodes(startNodeId, completedNodes);
            }

            resolve();
          },
          onError: (err: any) => {
            console.error(`❌ Node ${startNodeId} failed:`, err);
            resolve();
          },
        } as NodeExecutionDetail,
      });
      window.dispatchEvent(event);
    });
  }

  /**
   * Handle any branching node by picking the next edge
   * based on the sourceHandle → target map (universal)
   */
  private async handleBranchNodeResult(
    nodeId: string,
    result: any,
    completedNodes: Set<string>,
  ): Promise<void> {
    // Normalize result to handle key
    let handleKey: string;

    if (typeof result === "boolean") {
      handleKey = result.toString(); // "true" or "false"
    } else if (
      result &&
      typeof result === "object" &&
      ("true" in result || "false" in result)
    ) {
      // Handle current If node format: { true: boolean, false: boolean }
      handleKey =
        result.true === true ? "true" : result.false === true ? "false" : "";
    } else {
      handleKey = String(result);
    }

    // Look up the branch map
    const branchMap = this.conditionalMap.get(nodeId) || {};
    const targets = branchMap[handleKey] || [];

    if (targets.length === 0) {
      console.warn(`No branch found for node ${nodeId} handle "${handleKey}"`);
      return;
    }

    console.log(
      `🔀 Branch node ${nodeId} → handle "${handleKey}" → ${targets}`,
    );
    // Execute all targets for this branch
    for (const targetId of targets) {
      await this.executeConditionalChain(targetId, completedNodes);
    }
  }

  /**
   * Execute downstream nodes for non-conditional flows
   */
  private async executeDownstreamNodes(
    nodeId: string,
    completedNodes: Set<string>,
  ): Promise<void> {
    const downstream = this.context.edges.filter((e) => {
      if (e.source !== nodeId) return false;
      // Exclude edges from any branching node (not just If)
      const isBranchNode = this.conditionalMap.has(e.source);
      return !isBranchNode;
    });

    const tasks = downstream.map((e) => {
      console.log(`🔄 Triggering downstream: ${e.target}`);
      return this.executeConditionalChain(e.target, completedNodes);
    });

    await Promise.all(tasks);
  }

  /**
   * Highlight edges connected to a node, optionally specific to a target
   */
  private highlightEdges(nodeId: string, targetNodeId?: string): void {
    let connected;
    if (targetNodeId) {
      // Highlight only the specific edge from source to target (for conditional paths)
      connected = this.context.edges.filter(
        (e) => e.source === nodeId && e.target === targetNodeId,
      );
    } else {
      // Highlight all edges connected to the node
      connected = this.context.edges.filter(
        (e) => e.source === nodeId || e.target === nodeId,
      );
    }

    this.context.setEdges((edges) =>
      edges.map((edge) =>
        connected.some((c) => c.id === edge.id)
          ? {
              ...edge,
              animated: true,
              className: "executing-edge",
              style: {
                ...edge.style,
                stroke: "#22c55e",
                strokeWidth: 3,
                strokeLinecap: "round",
                strokeLinejoin: "round",
              },
            }
          : {
              ...edge,
              animated: false,
              className: "",
              style: {
                ...edge.style,
                stroke: undefined,
                strokeWidth: undefined,
              },
            },
      ),
    );
  }

  /**
   * Highlight a node (clears previous highlights first)
   */
  private highlightNode(nodeId: string): void {
    this.context.setNodes((nodes) =>
      nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              className: "executing-node",
              style: {
                ...n.style,
                border: "3px solid #22c55e",
                backgroundColor: "#f0fdf4",
                boxShadow: "0 0 20px rgba(34,197,94,0.4)",
              },
            }
          : {
              ...n,
              className: "",
              style: {
                ...n.style,
                border: undefined,
                backgroundColor: undefined,
                boxShadow: undefined,
              },
            },
      ),
    );
  }

  /**
   * Highlight a streaming node with different visual style
   */
  private highlightStreamingNode(nodeId: string): void {
    this.context.setNodes((nodes) =>
      nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              className: "streaming-node",
              data: {
                ...n.data,
                isStreamingWaiting: true,
              },
              style: {
                ...n.style,
                border: "3px solid #3b82f6",
                backgroundColor: "#eff6ff",
                boxShadow: "0 0 20px rgba(59,130,246,0.4)",
              },
            }
          : {
              ...n,
              className: "",
              style: {
                ...n.style,
                border: undefined,
                backgroundColor: undefined,
                boxShadow: undefined,
              },
            },
      ),
    );
  }

  /**
   * Execute a streaming node - subscribe and wait for first data
   */
  private async executeStreamingNode(
    nodeId: string,
    executedSet: Set<string>,
    explicitlyTriggered: boolean,
  ): Promise<any> {
    const node = this.context.nodes.find((n) => n.id === nodeId);
    const definition = node?.data?.definition as any;
    const timeout = definition?.streamingConfig?.timeout || 30000;

    console.log(
      `🌊 [STREAMING] Starting streaming node ${nodeId}, waiting for first event (timeout: ${timeout}ms)`,
    );

    this.context.setExecutingNode(nodeId);
    this.highlightEdges(nodeId);
    this.highlightStreamingNode(nodeId);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Step 1: Trigger subscription
    const subscribePromise = new Promise((resolve, reject) => {
      const execEvent = new CustomEvent("auto-execute-node", {
        detail: {
          nodeId,
          executedSet,
          allNodes: this.context.nodes,
          allEdges: this.context.edges,
          explicitlyTriggered,
          onSuccess: resolve,
          onError: reject,
        } as NodeExecutionDetail,
      });
      window.dispatchEvent(execEvent);
    });

    try {
      await subscribePromise;
      console.log(`✅ [STREAMING] Node ${nodeId} subscription successful`);
    } catch (error) {
      console.error(
        `❌ [STREAMING] Node ${nodeId} subscription failed:`,
        error,
      );
      throw error;
    }

    // Step 2: Wait for first real data from WebSocket
    console.log(`⏳ [STREAMING] Waiting for first data from ${nodeId}...`);

    const dataPromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(
          new Error(
            `Streaming node ${nodeId} timed out waiting for data after ${timeout}ms`,
          ),
        );
      }, timeout);

      const checkData = () => {
        const nodeData = this.nodeStore.getNodeData(nodeId);
        const output = nodeData?.output;

        // Check if we have actual streaming data (not just "subscribed" status)
        if (
          output &&
          output.status === "streaming" &&
          (output.news ||
            output.data ||
            output.trade ||
            output.quote ||
            output.bar ||
            output.dailyBar)
        ) {
          clearTimeout(timeoutId);
          console.log(
            `📨 [STREAMING] Node ${nodeId} received first data:`,
            output,
          );
          resolve(output);
          return;
        }

        // Check for webhook data (TelegramTrigger, WebhookTrigger, etc.)
        if (output?.webhookPayload) {
          clearTimeout(timeoutId);
          console.log(
            `📨 [WEBHOOK] Node ${nodeId} received webhook event:`,
            output,
          );
          resolve(output);
          return;
        }

        // Poll every 100ms
        setTimeout(checkData, 100);
      };

      // Start polling after a brief delay to allow subscription to complete
      setTimeout(checkData, 200);
    });

    const result = await dataPromise;

    // Clear streaming visual state
    this.context.setNodes((nodes) =>
      nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                isStreamingWaiting: false,
              },
            }
          : n,
      ),
    );

    this.nodeStore.setNodeData(nodeId, { output: result });
    console.log(`🎉 [STREAMING] Node ${nodeId} completed with data`);

    return result;
  }

  /**
   * Helper method to aggregate payloads to Loop nodes when an edge fires
   */
  private aggregateToLoop(sourceNodeId: string, edge: Edge, result: any): void {
    const targetNode = this.context.nodes.find((n) => n.id === edge.target);
    const isLoop = (targetNode?.data?.definition as any)?.name === "Loop";

    if (!isLoop) return;

    const loopId = edge.target;

    // Check if this is a feedback edge (source node is downstream of the Loop)
    // vs a trigger edge (source node is upstream/independent of the Loop)
    const isFeedbackEdge = this.isNodeDownstreamOfLoop(sourceNodeId, loopId);

    if (!isFeedbackEdge) {
      console.log(
        `🚫 [LOOP AGGREGATION] Skipping trigger edge ${edge.id} from ${sourceNodeId} to Loop ${loopId} - not a feedback edge`,
      );
      return;
    }

    const loopData = this.nodeStore.getNodeData(loopId) || {};
    const buf = { ...(loopData._edgeBuf || {}) } as Record<string, any>;
    buf[edge.id] = result;
    this.nodeStore.setNodeData(loopId, { ...loopData, _edgeBuf: buf });

    console.log(
      `🔄 [LOOP AGGREGATION] Edge ${edge.id} from ${sourceNodeId} to Loop ${loopId} aggregated feedback result:`,
      result,
    );

    // Optional: mirror payload to edge UI for visibility
    this.context.setEdges((eds) =>
      eds.map((e) =>
        e.id === edge.id
          ? { ...e, data: { ...e.data, lastPayload: result } }
          : e,
      ),
    );
  }

  /**
   * Check if a source node is downstream of a Loop node (i.e., it's part of the loop flow)
   * This helps distinguish between trigger edges and feedback edges
   */
  private isNodeDownstreamOfLoop(
    sourceNodeId: string,
    loopNodeId: string,
  ): boolean {
    // Get all nodes that are downstream of the Loop node
    const downstreamNodes = this.getDownstreamNodes(loopNodeId, new Set());

    // If the source node is in the downstream nodes, it's a feedback edge
    return downstreamNodes.has(sourceNodeId);
  }

  /**
   * Get all nodes downstream of a given node
   */
  private getDownstreamNodes(
    nodeId: string,
    visited: Set<string> = new Set(),
  ): Set<string> {
    if (visited.has(nodeId)) return new Set();

    visited.add(nodeId);
    const downstream = new Set<string>();

    // Find all outgoing edges from this node
    const outgoingEdges = this.context.edges.filter((e) => e.source === nodeId);

    for (const edge of outgoingEdges) {
      downstream.add(edge.target);
      // Recursively get downstream nodes, but avoid infinite loops
      const nestedDownstream = this.getDownstreamNodes(
        edge.target,
        new Set(visited),
      );
      nestedDownstream.forEach((id) => downstream.add(id));
    }

    return downstream;
  }

  /**
   * Execute a single node with visual feedback
   */
  async executeNode(
    nodeId: string,
    executedSet: Set<string>,
    explicitlyTriggered = false,
  ): Promise<any> {
    const node = this.context.nodes.find((n) => n.id === nodeId);
    if (!node) {
      console.error(`❌ [WORKFLOW EXECUTOR] Node ${nodeId} not found`);
      return;
    }

    // Check if this is a streaming node
    if (this.isStreamingNode(nodeId)) {
      console.log(`🌊 [WORKFLOW EXECUTOR] Detected streaming node: ${nodeId}`);
      return this.executeStreamingNode(
        nodeId,
        executedSet,
        explicitlyTriggered,
      );
    }

    const execData = this.nodeStore.getNodeData(nodeId);
    const defName = (node.data.definition as any)?.name;
    const fieldState = node.data.fieldState || node.data.values || {};

    this.context.setExecutingNode(nodeId);
    this.highlightEdges(nodeId);
    //this.highlightNode(nodeId);

    // Default (non-Loop) node execution
    const result: any = await Promise.race([
      new Promise((resolve, reject) => {
        const execEvent = new CustomEvent("auto-execute-node", {
          detail: {
            nodeId,
            executedSet,
            allNodes: this.context.nodes,
            allEdges: this.context.edges,
            explicitlyTriggered,
            onSuccess: (res?: any) => {
              resolve(res);
            },
            onError: (err: any) => {
              reject(err);
            },
          } as NodeExecutionDetail,
        });
        window.dispatchEvent(execEvent);
      }),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(new Error(`Node ${nodeId} execution timed out after 30s`)),
          30000,
        ),
      ),
    ]);

    this.nodeStore.setNodeData(nodeId, { output: result });

    // Downstream delivery and Loop aggregation are handled after execution
    // when enqueueing downstream nodes.

    return result;
  }

  /**
   * Execute all nodes using optimized FIFO queue with cycle detection and retry limits
   */
  async executeAllNodes(): Promise<void> {
    console.log(
      "🚀 [WORKFLOW EXECUTOR] Starting optimized FIFO queue‑based workflow execution",
    );

    if (this.isAutoExecuting) {
      console.log("⚠️ [WORKFLOW EXECUTOR] Execution already in progress");
      return;
    }

    this.isAutoExecuting = true;
    this.preCalculateConditionalBranches(); // Refresh conditional map
    this.edgePayload.clear();

    // Initialize execution metrics
    const metrics: ExecutionMetrics = {
      startTime: performance.now(),
      nodeTimings: new Map(),
      totalNodes: this.context.nodes.length,
      failedNodes: new Set(),
      completedNodes: new Set(),
    };

    const executed = new Set<string>();
    const failed = new Set<string>();
    const retryCount = new Map<string, number>();
    const MAX_RETRIES = this.context.nodes.length * 2;

    const roots = this.context.nodes
      .filter(
        (n) =>
          ((n.data.definition as any)?.node_type === "trigger" ||
            (n.data.definition as any)?.node_type === "backtest") &&
          !this.context.edges.some((e) => e.target === n.id),
      )
      .map((n) => n.id);
    const queue: string[] = [...roots];

    console.log(
      `🎯 [WORKFLOW EXECUTOR] Found ${roots.length} root nodes:`,
      roots,
    );

    const barState = {
      onBarNodeId: null as string | null,
      onBarHasMore: false,
    };

    const runInnerQueue = async () => {
      while (queue.length) {
        const id = queue.shift()!;
        //if (executed.has(id) || failed.has(id)) continue;
        const node = this.context.nodes.find((n) => n.id === id);

        // const inc = this.context.edges.filter((e) => e.target === id);
        // const missing =
        //   (node.data.definition as any)?.node_type == "trigger" ||
        //   (node.data.definition as any)?.node_type == "backtest" ||
        //   node.type === "Loop"
        //     ? []
        //     : inc.filter(
        //         (e) => !executed.has(e.source) && !failed.has(e.source),
        //       );

        // if (missing.length) {
        //   const retries = retryCount.get(id) || 0;
        //   if (retries >= MAX_RETRIES) {
        //     console.error(
        //       `❌ [WORKFLOW EXECUTOR] Node ${id} exceeded retry limit (${MAX_RETRIES}), marking as failed`,
        //     );
        //     failed.add(id);
        //     metrics.failedNodes.add(id);
        //     continue;
        //   }
        //   retryCount.set(id, retries + 1);
        //   queue.push(id);
        //   continue;
        // }

        console.log(`⚡ [WORKFLOW EXECUTOR] Executing node: ${id}`);
        const nodeStart = performance.now();

        try {
          // Check if this is a conditional target that should be explicitly triggered
          const isConditionalTarget = retryCount.has(id + "_conditional");
          const result = await this.executeNode(
            id,
            executed,
            isConditionalTarget,
          );
          if (node.type === "Loop") {
            const nodeData = this.nodeStore.getNodeData(node.id);
            const isFinalBatch = nodeData.done;
            if (isFinalBatch) {
              const doneEdges = this.context.edges.filter(
                (e) => e.source === node.id && e.sourceHandle === "done",
              );
              doneEdges.forEach((e) => {
                this.nodeStore.setNodeData(e.target, {
                  input: nodeData.aggregated,
                });
              });
            }
          }
          //if (isConditionalTarget) {
          //  retryCount.delete(id + "_conditional"); // Clean up the flag
          //}
          const nodeTime = performance.now() - nodeStart;
          metrics.nodeTimings.set(id, nodeTime);

          executed.add(id);
          metrics.completedNodes.add(id);
          console.log(
            `✅ [WORKFLOW EXECUTOR] Node ${id} completed in ${nodeTime.toFixed(
              2,
            )}ms`,
          );

          const defName = (node.data?.definition as any)?.name;

          // Add delay between node executions to make highlighting visible
          await new Promise((resolve) => setTimeout(resolve, 50));

          let out = this.context.edges.filter((e) => e.source === id);
          if (node.type === "Loop") {
            const loopState = this.nodeStore.getNodeData(id);
            out = out.filter((e) =>
              loopState.done
                ? e.sourceHandle === "done"
                : !e.sourceHandle || e.sourceHandle === "loop",
            );
          }

          console.log(
            `🔍 [WORKFLOW EXECUTOR] Node ${id} has ${out.length} outgoing edges:`,
            out.map((e) => `${e.source} → ${e.target}`),
          );

          // Use optimized conditional branch handling
          let next: Edge[] = [];
          let isConditionalExecution = false;
          let conditionalTargetId: string | undefined;

          const isBranchNode = this.conditionalMap.has(id);
          console.log(
            `🔍 [WORKFLOW EXECUTOR] Node ${id} is branch node: ${isBranchNode}, conditionalMap has:`,
            Array.from(this.conditionalMap.keys()),
          );

          if (isBranchNode) {
            console.log(
              `🌿 [WORKFLOW EXECUTOR] Processing as branch node: ${id}`,
            );

            // 1) figure out the handle key exactly as you already do
            let handleKey: string;
            if (typeof result === "boolean") {
              handleKey = result.toString();
            } else if (
              result &&
              typeof result === "object" &&
              result.data &&
              ("true" in result.data || "false" in result.data)
            ) {
              handleKey =
                result.data.true === true
                  ? "true"
                  : result.data.false === true
                    ? "false"
                    : "";
            } else {
              handleKey = String(result.output || result);
            }
            console.log(
              `🔑 [WORKFLOW EXECUTOR] Branch node ${id} result handle key: "${handleKey}"`,
            );

            // 2) pull back an array of targets (might be undefined)
            const branchMap = this.conditionalMap.get(id) || {};
            console.log(
              `🗺️ [WORKFLOW EXECUTOR] Branch map for ${id}:`,
              branchMap,
            );

            // --- CHANGED HERE: treat entry as string[] not single string ---
            const targets: string[] = branchMap[handleKey] || [];

            if (targets.length > 0) {
              // 3) for each target node, find its outgoing edge and collect into next[]
              next = targets
                .map((targetNodeId) =>
                  out.find((e) => e.target === targetNodeId),
                )
                .filter((e): e is Edge => !!e);

              isConditionalExecution = true;
              conditionalTargetId = targets.join(","); // or pick the first if you need a single string

              console.log(
                `🔀 [WORKFLOW EXECUTOR] Branch node ${id} taking "${handleKey}" path to`,
                targets,
              );

              // 4) highlight them all
              targets.forEach((t) => this.highlightEdges(id, t));
            } else {
              console.log(
                `⚠️ [WORKFLOW EXECUTOR] No targets found for branch node ${id} with handle "${handleKey}"`,
              );
            }
          } else {
            console.log(
              `📋 [WORKFLOW EXECUTOR] Processing as regular node: ${id}, setting next = out (${out.length} edges)`,
            );
            next = out;
            console.log(
              `➡️ [WORKFLOW EXECUTOR] Non-branch node ${id} will queue ${next.length} downstream nodes:`,
              next.map((e) => e.target),
            );
          }

          // Deliver payloads, record them, and enqueue when dependencies are satisfied
          console.log(
            `📝 [WORKFLOW EXECUTOR] About to deliver ${next.length} edges from node ${id}`,
          );
          for (const e of next) {
            this.nodeStore.setNodeData(e.target, { input: result });
            this.aggregateToLoop(id, e, result);
            this.markEdgePayload(e.id, result);

            if (
              !queue.includes(e.target) &&
              this.areDependenciesSatisfied(e.target, executed, failed)
            ) {
              queue.push(e.target);
              // if (isConditionalExecution) {
              //   retryCount.set(e.target + "_conditional", 1);
              // }
            }
          }

          if (defName === "OnBar") {
            barState.onBarNodeId = id;
            barState.onBarHasMore = result?.data?.isLast === false;
          }

          this.clearIncomingEdgePayloads(id);
          console.log(
            `📋 [WORKFLOW EXECUTOR] Current queue after processing ${id}:`,
            queue,
          );
        } catch (error) {
          const nodeTime = performance.now() - nodeStart;
          metrics.nodeTimings.set(id, nodeTime);
          failed.add(id);
          metrics.failedNodes.add(id);
          console.error(
            `❌ [WORKFLOW EXECUTOR] Node ${id} failed after ${nodeTime.toFixed(
              2,
            )}ms:`,
            error,
          );

          this.clearIncomingEdgePayloads(id);

          // Continue execution of non-dependent nodes
          const independentNodes = this.context.nodes.filter(
            (n) =>
              !executed.has(n.id) &&
              !failed.has(n.id) &&
              !queue.includes(n.id) &&
              !this.context.edges.some(
                (e) => e.target === n.id && e.source === id,
              ),
          );
          independentNodes.forEach((n) => queue.push(n.id));
        }
      }
    };

    try {
      // Phase 1: Full DAG execution (BacktestInit → OnBar → downstream)
      await runInnerQueue();

      // Phase 2: Bar iteration loop (OnBar → downstream only)
      while (barState.onBarNodeId && barState.onBarHasMore) {
        const downstream = this.getDownstreamNodes(
          barState.onBarNodeId,
          new Set(),
        );
        for (const downId of downstream) {
          executed.delete(downId);
          failed.delete(downId);
          this.clearIncomingEdgePayloads(downId);
        }

        executed.delete(barState.onBarNodeId);
        failed.delete(barState.onBarNodeId);
        this.clearIncomingEdgePayloads(barState.onBarNodeId);

        queue.push(barState.onBarNodeId);
        barState.onBarHasMore = false;

        await runInnerQueue();
      }

      const totalTime = performance.now() - metrics.startTime;
      const successCount = metrics.completedNodes.size;
      const failureCount = metrics.failedNodes.size;

      console.log(
        `🎉 [WORKFLOW EXECUTOR] Execution complete in ${totalTime.toFixed(2)}ms`,
      );
      console.log(
        `📊 [WORKFLOW EXECUTOR] Results: ${successCount} succeeded, ${failureCount} failed`,
      );

      if (metrics.nodeTimings.size > 0) {
        const avgTime =
          Array.from(metrics.nodeTimings.values()).reduce((a, b) => a + b, 0) /
          metrics.nodeTimings.size;
        console.log(
          `⏱️ [WORKFLOW EXECUTOR] Average node execution time: ${avgTime.toFixed(
            2,
          )}ms`,
        );
      }

      this.context.toast({
        title: "Workflow Execution Complete",
        description: `${successCount} nodes succeeded${
          failureCount > 0 ? `, ${failureCount} failed` : ""
        }`,
      });
    } catch (err: any) {
      console.error("❌ [WORKFLOW EXECUTOR] Critical execution error:", err);
      this.context.toast({
        title: "Workflow Execution Error",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      this.isAutoExecuting = false;
      this.context.setExecutingNode(null);
      this.context.setEdges((edges) =>
        edges.map((e) => ({
          ...e,
          animated: false,
          className: "",
          style: { ...e.style, stroke: undefined, strokeWidth: undefined },
        })),
      );
      this.context.setNodes((nodes) =>
        nodes.map((n) => ({
          ...n,
          className: "",
          style: {
            ...n.style,
            border: undefined,
            backgroundColor: undefined,
            boxShadow: undefined,
          },
        })),
      );
    }
  }

  setAutoExecuting(val: boolean): void {
    this.isAutoExecuting = val;
  }

  getIsAutoExecuting(): boolean {
    return this.isAutoExecuting;
  }
}
