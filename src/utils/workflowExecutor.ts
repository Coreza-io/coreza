import { Node, Edge } from '@xyflow/react';
import ExecutionContext from './executionContext';

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
    explicitlyTriggered?: boolean
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

  // ===== Runtime (non-reactive) =====
  private triggeredEdges = new Set<string>();
  private edgeState = new Map<string, { relevant?: boolean; fired?: boolean; payload?: any }>();

  // Helper lookups
  private isBranchNodeId = (id: string) => {
    const n = this.context.nodes.find(x => x.id === id);
    const name = (n?.data?.definition as any)?.name;
    return name === 'If' || name === 'Switch';
    };

  private isLoopNodeId = (id: string) => {
    const n = this.context.nodes.find(x => x.id === id);
    const name = (n?.data?.definition as any)?.name;
    return name === 'Loop';
  };

  private getIncomingEdges = (targetId: string) =>
    this.context.edges.filter(e => e.target === targetId);

  private getOutgoingEdges = (sourceId: string) =>
    this.context.edges.filter(e => e.source === sourceId);

  // Optional UI mirroring / config
  private debugEdgeFlags = true; // set false in prod
  private loopStartsEarly = true;
  private treatFailedAsSatisfied = true;

  private batchMirrorEdgeState(patches: Array<{ id: string; patch: any }>) {
    if (!this.debugEdgeFlags || !this.context.setEdges) return;
    this.context.setEdges((eds: any[]) =>
      eds.map(e => {
        const p = patches.find(x => x.id === e.id);
        return p ? { ...e, data: { ...(e.data ?? {}), ...p.patch } } : e;
      })
    );
  }

  private markEdgeRelevant(edgeId: string, yes = true) {
    const prev = this.edgeState.get(edgeId) ?? {};
    this.edgeState.set(edgeId, { ...prev, relevant: yes });
    this.batchMirrorEdgeState([{ id: edgeId, patch: { __relevant: yes } }]);
  }

  private markEdgeFired(edgeId: string, payload: any) {
    this.triggeredEdges.add(edgeId);
    const prev = this.edgeState.get(edgeId) ?? {};
    this.edgeState.set(edgeId, { ...prev, fired: true, payload });
    this.batchMirrorEdgeState([{ id: edgeId, patch: { __fired: true, __payload: payload } }]);
  }

  private clearIncomingEdgeState(nodeId: string) {
    const incoming = this.getIncomingEdges(nodeId);
    const patches: Array<{ id: string; patch: any }> = [];
    for (const e of incoming) {
      const prev = this.edgeState.get(e.id) ?? {};
      this.edgeState.set(e.id, { ...prev, fired: false, payload: undefined, relevant: prev.relevant });
      this.triggeredEdges.delete(e.id);
      if (this.debugEdgeFlags) patches.push({ id: e.id, patch: { __fired: false, __payload: undefined } });
    }
    if (patches.length) this.batchMirrorEdgeState(patches);
  }

  private areDependenciesSatisfied(
    nodeId: string,
    executed: Set<string>,
    failed: Set<string>
  ): boolean {
    // Loop special-case
    if (this.isLoopNodeId(nodeId)) {
      const node = this.context.nodes.find(n => n.id === nodeId);
      const loopWaits = node?.data?.loopWaits ?? !this.loopStartsEarly ? true : false;
      if (!loopWaits) return true;
      // else fall through
    }

    const inEdges = this.getIncomingEdges(nodeId);
    if (inEdges.length === 0) return true;

    const node = this.context.nodes.find(n => n.id === nodeId);
    const waitAll: boolean = node?.data?.waitForAllInputs ?? true;

    const requiredEdges = inEdges.filter(e => {
      if (failed.has(e.source)) return !this.treatFailedAsSatisfied;
      if (this.isBranchNodeId(e.source)) {
        return this.triggeredEdges.has(e.id);
      }
      return true;
    });

    if (requiredEdges.length === 0) return true;

    const firedCount = requiredEdges.filter(e => this.triggeredEdges.has(e.id)).length;
    return waitAll ? firedCount === requiredEdges.length : firedCount > 0;
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

      // Build a map: nodeId → { handle1: [targetA, targetB], handle2: [targetC], … }
      this.context.edges.forEach(edge => {
        const sourceNode = this.context.nodes.find(n => n.id === edge.source);
        const nodeType = (sourceNode?.data?.definition as any)?.name;
        const isBranchingNode = ['If', 'Switch'].includes(nodeType);
        if (!edge.sourceHandle || !isBranchingNode) return;

        // get—or initialize—the per-node entry
        const entry: Record<string, string[]> =
          this.conditionalMap.get(edge.source)
          ?? {};

        // accumulate multiple targets per handle
        (entry[edge.sourceHandle] ??= []).push(edge.target);

        this.conditionalMap.set(edge.source, entry);
      });

      console.log(
        `🗺️ [WORKFLOW EXECUTOR] Built conditional map for ${
          this.conditionalMap.size
        } branching nodes:`,
        Array.from(this.conditionalMap.entries())
      );
    }


  /**
   * Detect cycles in the workflow graph
   */
  private detectCycles(): boolean {
    const visitedInCycle = new Set<string>();
    const inCurrentPath = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      if (inCurrentPath.has(nodeId)) return true;
      if (visitedInCycle.has(nodeId)) return false;
      
      visitedInCycle.add(nodeId);
      inCurrentPath.add(nodeId);
      
      const outgoing = this.context.edges.filter(e => e.source === nodeId);
      for (const edge of outgoing) {
        if (hasCycle(edge.target)) return true;
      }
      
      inCurrentPath.delete(nodeId);
      return false;
    };

    for (const node of this.context.nodes) {
      if (!visitedInCycle.has(node.id) && hasCycle(node.id)) {
        console.error(`🔄 Cycle detected starting from node: ${node.id}`);
        return true;
      }
    }
    return false;
  }

  /**
   * Execute conditional chain starting from a specific node
   */
  async executeConditionalChain(
    startNodeId: string,
    completedNodes: Set<string>
  ): Promise<void> {
    console.log(`🎯 Starting conditional chain from: ${startNodeId}`);

    return new Promise<void>(resolve => {
      const event = new CustomEvent('auto-execute-node', {
        detail: {
          nodeId: startNodeId,
          executedSet: completedNodes,
          allNodes: this.context.nodes,
          allEdges: this.context.edges,
          onSuccess: async (result?: any) => {
            console.log(`✅ Node ${startNodeId} succeeded with result`, result);
            completedNodes.add(startNodeId);
            const currentNode = this.context.nodes.find(n => n.id === startNodeId);

            const isBranchNode = this.conditionalMap.has(startNodeId);
            if (isBranchNode) {
              await this.handleBranchNodeResult(startNodeId, result, completedNodes);
            } else {
              await this.executeDownstreamNodes(startNodeId, completedNodes);
            }

            resolve();
          },
          onError: (err: any) => {
            console.error(`❌ Node ${startNodeId} failed:`, err);
            resolve();
          }
        } as NodeExecutionDetail
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
    completedNodes: Set<string>
  ): Promise<void> {
    // Normalize result to handle key
    let handleKey: string;
    
    if (typeof result === 'boolean') {
      handleKey = result.toString(); // "true" or "false"
    } else if (result && typeof result === 'object' && ('true' in result || 'false' in result)) {
      // Handle current If node format: { true: boolean, false: boolean }
      handleKey = result.true === true ? 'true' : result.false === true ? 'false' : '';
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

    console.log(`🔀 Branch node ${nodeId} → handle "${handleKey}" → ${targets}`);
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
    completedNodes: Set<string>
  ): Promise<void> {
    const downstream = this.context.edges.filter(e => {
      if (e.source !== nodeId) return false;
      // Exclude edges from any branching node (not just If)
      const isBranchNode = this.conditionalMap.has(e.source);
      return !isBranchNode;
    });

    const tasks = downstream.map(e => {
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
        e => e.source === nodeId && e.target === targetNodeId
      );
    } else {
      // Highlight all edges connected to the node
      connected = this.context.edges.filter(
        e => e.source === nodeId || e.target === nodeId
      );
    }
    
    this.context.setEdges(edges =>
      edges.map(edge =>
        connected.some(c => c.id === edge.id)
          ? { ...edge, animated: true, className: 'executing-edge', style: { ...edge.style, stroke: '#22c55e', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' } }
          : { ...edge, animated: false, className: '', style: { ...edge.style, stroke: undefined, strokeWidth: undefined } }
      )
    );
  }

  /**
   * Clear all node highlights
   */
  private clearNodeHighlights(): void {
    this.context.setNodes(nodes =>
      nodes.map(n => ({ 
        ...n, 
        className: '', 
        style: { 
          ...n.style, 
          border: undefined, 
          backgroundColor: undefined, 
          boxShadow: undefined 
        } 
      }))
    );
  }

  /**
   * Highlight a node (clears previous highlights first)
   */
  private highlightNode(nodeId: string): void {
    this.context.setNodes(nodes =>
      nodes.map(n =>
        n.id === nodeId
          ? { ...n, className: 'executing-node', style: { ...n.style, border: '3px solid #22c55e', backgroundColor: '#f0fdf4', boxShadow: '0 0 20px rgba(34,197,94,0.4)' } }
          : { ...n, className: '', style: { ...n.style, border: undefined, backgroundColor: undefined, boxShadow: undefined } }
      )
    );
  }

  /**
   * Helper method to aggregate payloads to Loop nodes when an edge fires
   */
  private aggregateToLoop(sourceNodeId: string, edge: Edge, result: any): void {
    const targetNode = this.context.nodes.find(n => n.id === edge.target);
    const isLoop = (targetNode?.data?.definition as any)?.name === 'Loop';

    if (!isLoop) return;

    const loopId = edge.target;
    
    // Check if this is a feedback edge (source node is downstream of the Loop)
    // vs a trigger edge (source node is upstream/independent of the Loop)
    const isFeedbackEdge = this.isNodeDownstreamOfLoop(sourceNodeId, loopId);
    
    if (!isFeedbackEdge) {
      console.log(`🚫 [LOOP AGGREGATION] Skipping trigger edge ${edge.id} from ${sourceNodeId} to Loop ${loopId} - not a feedback edge`);
      return;
    }

    const loopData = this.nodeStore.getNodeData(loopId) || {};
    const buf = { ...(loopData._edgeBuf || {}) } as Record<string, any>;
    buf[edge.id] = result;
    this.nodeStore.setNodeData(loopId, { ...loopData, _edgeBuf: buf });

    console.log(`🔄 [LOOP AGGREGATION] Edge ${edge.id} from ${sourceNodeId} to Loop ${loopId} aggregated feedback result:`, result);

    // Optional: mirror payload to edge UI for visibility
    this.context.setEdges(eds =>
      eds.map(e =>
        e.id === edge.id ? { ...e, data: { ...e.data, lastPayload: result } } : e
      )
    );
  }

  /**
   * Check if a source node is downstream of a Loop node (i.e., it's part of the loop flow)
   * This helps distinguish between trigger edges and feedback edges
   */
  private isNodeDownstreamOfLoop(sourceNodeId: string, loopNodeId: string): boolean {
    // Get all nodes that are downstream of the Loop node
    const downstreamNodes = this.getDownstreamNodes(loopNodeId, new Set());
    
    // If the source node is in the downstream nodes, it's a feedback edge
    return downstreamNodes.has(sourceNodeId);
  }

  /**
   * Get all nodes downstream of a given node
   */
  private getDownstreamNodes(nodeId: string, visited: Set<string> = new Set()): Set<string> {
    if (visited.has(nodeId)) return new Set();
    
    visited.add(nodeId);
    const downstream = new Set<string>();
    
    // Find all outgoing edges from this node
    const outgoingEdges = this.context.edges.filter(e => e.source === nodeId);
    
    for (const edge of outgoingEdges) {
      downstream.add(edge.target);
      // Recursively get downstream nodes, but avoid infinite loops
      const nestedDownstream = this.getDownstreamNodes(edge.target, new Set(visited));
      nestedDownstream.forEach(id => downstream.add(id));
    }
    
    return downstream;
  }

  /**
   * Execute a single node with visual feedback
   */
  async executeNode(
    nodeId: string,
    executedSet: Set<string>,
    explicitlyTriggered = false
  ): Promise<any> {
    const node = this.context.nodes.find(n => n.id === nodeId);
    if (!node) {
      console.error(`❌ [WORKFLOW EXECUTOR] Node ${nodeId} not found`);
      return;
    }

    const execData = this.nodeStore.getNodeData(nodeId);
    const defName = (node.data.definition as any)?.name;
    const fieldState = node.data.fieldState || node.data.values || {};

    this.context.setExecutingNode(nodeId);
    this.highlightEdges(nodeId);
    this.highlightNode(nodeId);

    await new Promise(resolve => setTimeout(resolve, 100));

    // Default (non-Loop) node execution
    const result: any = await new Promise((resolve, reject) => {
      const execEvent = new CustomEvent('auto-execute-node', {
        detail: {
          nodeId,
          executedSet,
          allNodes: this.context.nodes,
          allEdges: this.context.edges,
          explicitlyTriggered,
          onSuccess: async (res?: any) => {
            await new Promise(r => setTimeout(r, 300));
            resolve(res);
          },
          onError: async (err: any) => {
            await new Promise(r => setTimeout(r, 300));
            reject(err);
          }
        } as NodeExecutionDetail
      });
      window.dispatchEvent(execEvent);
    });

    this.nodeStore.setNodeData(nodeId, { output: result });

    return result;
  }


  /**
   * Execute all nodes using optimized FIFO queue with cycle detection and retry limits
   */
  async executeAllNodes(): Promise<void> {
    console.log('🚀 [WORKFLOW EXECUTOR] Starting optimized FIFO queue‑based workflow execution');

    if (this.isAutoExecuting) {
      console.log('⚠️ [WORKFLOW EXECUTOR] Execution already in progress');
      return;
    }

    this.isAutoExecuting = true;
    this.preCalculateConditionalBranches(); // Refresh conditional map
    this.triggeredEdges.clear();
    this.edgeState.clear();
    if (this.debugEdgeFlags && this.context.setEdges) {
      this.context.setEdges((eds: any[]) =>
        eds.map(e => ({
          ...e,
          data: { ...(e.data ?? {}), __relevant: undefined, __fired: false, __payload: undefined }
        }))
      );
    }

    // Initialize execution metrics
    const metrics: ExecutionMetrics = {
      startTime: performance.now(),
      nodeTimings: new Map(),
      totalNodes: this.context.nodes.length,
      failedNodes: new Set(),
      completedNodes: new Set()
    };

    const executed = new Set<string>();
    const failed = new Set<string>();
    const retryCount = new Map<string, number>();
    const MAX_RETRIES = this.context.nodes.length * 2;

    const roots = this.context.nodes
      .filter(n => !this.context.edges.some(e => e.target === n.id))
      .map(n => n.id);
    const queue: string[] = [...roots];

    console.log(`🎯 [WORKFLOW EXECUTOR] Found ${roots.length} root nodes:`, roots);

    try {
      while (queue.length) {
        const id = queue.shift()!;

        // Defensive readiness gate
        if (!this.areDependenciesSatisfied(id, executed, failed)) {
          const tries = (retryCount.get(id) ?? 0) + 1;
          if (tries <= MAX_RETRIES) {
            retryCount.set(id, tries);
            queue.push(id);
          } else {
            failed.add(id);
            metrics.failedNodes.add(id);
            console.error(`❌ [WORKFLOW EXECUTOR] Node ${id} exceeded retry limit (${MAX_RETRIES}), marking as failed`);
          }
          continue;
        }

        const node = this.context.nodes.find(n => n.id === id);
        if (!node) continue;

        console.log(`⚡ [WORKFLOW EXECUTOR] Executing node: ${id}`);
        const nodeStart = performance.now();

        try {
          const isConditionalTarget = retryCount.has(id + "_conditional");
          const result = await this.executeNode(id, executed, isConditionalTarget);

          // Loop post-run handling
          if (node.type === 'Loop') {
            const nodeData = this.nodeStore.getNodeData(node.id);
            const isFinalBatch = nodeData.done;
            if (isFinalBatch) {
              const doneEdges = this.context.edges.filter(
                e => e.source === node.id && e.sourceHandle === 'done'
              );
              doneEdges.forEach(e => {
                this.nodeStore.setNodeData(e.target, { input: nodeData.aggregated });
              });
            }
          }

          const nodeTime = performance.now() - nodeStart;
          metrics.nodeTimings.set(id, nodeTime);
          executed.add(id);
          metrics.completedNodes.add(id);
          console.log(`✅ [WORKFLOW EXECUTOR] Node ${id} completed in ${nodeTime.toFixed(2)}ms`);

          // Visibility delay
          await new Promise(resolve => setTimeout(resolve, 500));

          // Determine outgoing edges
          let out = this.context.edges.filter(e => e.source === id);
          if (node.type === 'Loop') {
            const loopState = this.nodeStore.getNodeData(id);
            out = out.filter(e =>
              loopState.done
                ? e.sourceHandle === 'done'
                : !e.sourceHandle || e.sourceHandle === 'loop'
            );
          }

          let next: Edge[] = [];
          let isConditionalExecution = false;
          const isBranchNode = this.conditionalMap.has(id);

          if (isBranchNode) {
            // Determine handle key
            let handleKey: string;
            if (typeof result === 'boolean') {
              handleKey = result.toString();
            } else if (result && typeof result === 'object' && ('true' in result || 'false' in result)) {
              handleKey = result.true === true ? 'true' : result.false === true ? 'false' : '';
            } else {
              handleKey = String(result.output || result);
            }

            const branchMap = this.conditionalMap.get(id) || {};
            const targets: string[] = branchMap[handleKey] || [];

            // Mark relevance for branch edges
            const allOut = this.getOutgoingEdges(id);
            for (const e of allOut) this.markEdgeRelevant(e.id, false);

            next = targets
              .map(targetNodeId => out.find(e => e.target === targetNodeId))
              .filter((e): e is Edge => !!e);

            for (const e of next) this.markEdgeRelevant(e.id, true);

            isConditionalExecution = true;
            targets.forEach(t => this.highlightEdges(id, t));
          } else {
            next = out;
          }

          // Fan-out: deliver payload and mark edges fired
          for (const e of next) {
            let payload: any = result;
            if (node.type === 'Loop') {
              const loopState = this.nodeStore.getNodeData(id);
              payload = e.sourceHandle === 'done' ? loopState.aggregated : result;
            }
            this.nodeStore.setNodeData(e.target, { input: payload });
            this.aggregateToLoop(id, e, payload);
            this.markEdgeFired(e.id, payload);
          }

          const uniqueTargets = [...new Set(next.map(e => e.target))];
          for (const targetId of uniqueTargets) {
            if (
              !queue.includes(targetId) &&
              !executed.has(targetId) &&
              !failed.has(targetId) &&
              this.areDependenciesSatisfied(targetId, executed, failed)
            ) {
              queue.push(targetId);
              if (isConditionalExecution) {
                retryCount.set(targetId + "_conditional", 1);
              }
            }
          }

          this.clearIncomingEdgeState(id);
        } catch (error) {
          const nodeTime = performance.now() - nodeStart;
          metrics.nodeTimings.set(id, nodeTime);
          failed.add(id);
          metrics.failedNodes.add(id);
          console.error(`❌ [WORKFLOW EXECUTOR] Node ${id} failed after ${nodeTime.toFixed(2)}ms:`, error);

          // Continue execution of non-dependent nodes
          const independentNodes = this.context.nodes.filter(n =>
            !executed.has(n.id) &&
            !failed.has(n.id) &&
            !queue.includes(n.id) &&
            !this.context.edges.some(e => e.target === n.id && e.source === id)
          );
          independentNodes.forEach(n => queue.push(n.id));
        }
      }

      const totalTime = performance.now() - metrics.startTime;
      const successCount = metrics.completedNodes.size;
      const failureCount = metrics.failedNodes.size;

      console.log(`🎉 [WORKFLOW EXECUTOR] Execution complete in ${totalTime.toFixed(2)}ms`);
      console.log(`📊 [WORKFLOW EXECUTOR] Results: ${successCount} succeeded, ${failureCount} failed`);

      if (metrics.nodeTimings.size > 0) {
        const avgTime = Array.from(metrics.nodeTimings.values()).reduce((a, b) => a + b, 0) / metrics.nodeTimings.size;
        console.log(`⏱️ [WORKFLOW EXECUTOR] Average node execution time: ${avgTime.toFixed(2)}ms`);
      }

      this.context.toast({
        title: 'Workflow Execution Complete',
        description: `${successCount} nodes succeeded${failureCount > 0 ? `, ${failureCount} failed` : ''}`
      });
    } catch (err: any) {
      console.error('❌ [WORKFLOW EXECUTOR] Critical execution error:', err);
      this.context.toast({
        title: 'Workflow Execution Error',
        description: err.message || String(err),
        variant: 'destructive'
      });
    } finally {
      this.isAutoExecuting = false;
      this.context.setExecutingNode(null);
      this.context.setEdges(edges =>
        edges.map(e => ({ ...e, animated: false, className: '', style: { ...e.style, stroke: undefined, strokeWidth: undefined } }))
      );
      this.context.setNodes(nodes =>
        nodes.map(n => ({ ...n, className: '', style: { ...n.style, border: undefined, backgroundColor: undefined, boxShadow: undefined } }))
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