import { Node, Edge } from '@xyflow/react';
import { handleLoopExecution } from './loopExecution';

export interface ExecutionContext {
  nodes: Node[];
  edges: Edge[];
  setNodes: (update: (nodes: Node[]) => Node[]) => void;
  setEdges: (update: (edges: Edge[]) => Edge[]) => void;
  setExecutingNode: (nodeId: string | null) => void;
  toast: (params: any) => void;
  executeNode?: (nodeId: string, executed: Set<string>) => Promise<any>;
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
  executedNodes: Set<string>;
  allNodes: Node[];
  allEdges: Edge[];
  explicitlyTriggered?: boolean;
  loopItem?: any;
  loopIndex?: number;
  onSuccess?: (result?: any) => void;
  onError?: (error: any) => void;
}

export class WorkflowExecutor {
  private context: ExecutionContext;
  private isAutoExecuting = false;
  private conditionalMap = new Map<string, Record<string, string[]>>();

  constructor(context: ExecutionContext) {
    this.context = context;
    this.context.executeNode = this.executeNode.bind(this);
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
          executedNodes: completedNodes,
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
   * Execute a single node with visual feedback
   */
  async executeNode(
    nodeId: string,
    executedNodes: Set<string>,
    explicitlyTriggered: boolean = false
  ): Promise<any> {
    this.context.setExecutingNode(nodeId);
    this.highlightEdges(nodeId);
    this.highlightNode(nodeId);

    // Add a small delay to make highlighting visible
    await new Promise(resolve => setTimeout(resolve, 100));

    return new Promise<any>((resolve, reject) => {
      const execEvent = new CustomEvent('auto-execute-node', {
        detail: {
          nodeId,
          executedNodes,
          allNodes: this.context.nodes,
          allEdges: this.context.edges,
          explicitlyTriggered,
          onSuccess: async (result?: any) => {
            // Keep highlight visible for a moment after execution
            await new Promise(resolve => setTimeout(resolve, 300));
            resolve(result);
          },
          onError: async (err: any) => {
            // Keep highlight visible even on error
            await new Promise(resolve => setTimeout(resolve, 300));
            reject(err);
          }
        } as NodeExecutionDetail
      });
      window.dispatchEvent(execEvent);
    });
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
        if (executed.has(id) || failed.has(id)) continue;

        const inc = this.context.edges.filter(e => e.target === id);
        const missing = inc.filter(e => !executed.has(e.source) && !failed.has(e.source));
        
        if (missing.length) {
          const retries = retryCount.get(id) || 0;
          if (retries >= MAX_RETRIES) {
            console.error(`❌ [WORKFLOW EXECUTOR] Node ${id} exceeded retry limit (${MAX_RETRIES}), marking as failed`);
            failed.add(id);
            metrics.failedNodes.add(id);
            continue;
          }
          retryCount.set(id, retries + 1);
          queue.push(id);
          continue;
        }

        console.log(`⚡ [WORKFLOW EXECUTOR] Executing node: ${id}`);
        const nodeStart = performance.now();

        try {
          // Check if this is a conditional target that should be explicitly triggered
          const isConditionalTarget = retryCount.has(id + "_conditional");
          const result = await this.executeNode(id, executed, isConditionalTarget);
          if (isConditionalTarget) {
            retryCount.delete(id + "_conditional"); // Clean up the flag
          }
          const nodeTime = performance.now() - nodeStart;
          metrics.nodeTimings.set(id, nodeTime);
          
          executed.add(id);
          metrics.completedNodes.add(id);
          console.log(`✅ [WORKFLOW EXECUTOR] Node ${id} completed in ${nodeTime.toFixed(2)}ms`);

          // Add delay between node executions to make highlighting visible
          await new Promise(resolve => setTimeout(resolve, 500));

          const out = this.context.edges.filter(e => e.source === id);
          const node = this.context.nodes.find(n => n.id === id);
          
          // Check if this is a Loop node and handle iteration
          const isLoopNode = result?.isLoopNode || ((node?.data?.definition as any)?.name === 'Loop');
          if (isLoopNode && result?.items?.length > 0) {
            console.log(`🔄 [WORKFLOW EXECUTOR] Processing Loop node ${id} with ${result.items.length} items`);
            await handleLoopExecution(this.context, id, result, out, executed);
            continue; // Skip normal processing for loop nodes
          }
          
          console.log(`🔍 [WORKFLOW EXECUTOR] Node ${id} has ${out.length} outgoing edges:`, out.map(e => `${e.source} → ${e.target}`));
          
          // Use optimized conditional branch handling
          let next: Edge[] = [];
          let isConditionalExecution = false;
          let conditionalTargetId: string | undefined;
          
          const isBranchNode = this.conditionalMap.has(id);
          console.log(`🔍 [WORKFLOW EXECUTOR] Node ${id} is branch node: ${isBranchNode}, conditionalMap has:`, Array.from(this.conditionalMap.keys()));
          
          if (isBranchNode) {
            console.log(`🌿 [WORKFLOW EXECUTOR] Processing as branch node: ${id}`);

            // 1) figure out the handle key exactly as you already do
            let handleKey: string;
            if (typeof result === 'boolean') {
              handleKey = result.toString();
            } else if (
              result &&
              typeof result === 'object' &&
              ('true' in result || 'false' in result)
            ) {
              handleKey = result.true === true
                ? 'true'
                : result.false === true
                  ? 'false'
                  : '';
            } else {
              handleKey = String(result);
            }
            console.log(
              `🔑 [WORKFLOW EXECUTOR] Branch node ${id} result handle key: "${handleKey}"`
            );

            // 2) pull back an array of targets (might be undefined)
            const branchMap = this.conditionalMap.get(id) || {};
            console.log(
              `🗺️ [WORKFLOW EXECUTOR] Branch map for ${id}:`,
              branchMap
            );

            // --- CHANGED HERE: treat entry as string[] not single string ---
            const targets: string[] = branchMap[handleKey] || [];

            if (targets.length > 0) {
              // 3) for each target node, find its outgoing edge and collect into next[]
              next = targets
                .map(targetNodeId =>
                  out.find(e => e.target === targetNodeId)
                )
                .filter((e): e is Edge => !!e);

              isConditionalExecution = true;
              conditionalTargetId = targets.join(','); // or pick the first if you need a single string

              console.log(
                `🔀 [WORKFLOW EXECUTOR] Branch node ${id} taking "${handleKey}" path to`,
                targets
              );

              // 4) highlight them all
              targets.forEach(t => this.highlightEdges(id, t));
            } else {
              console.log(
                `⚠️ [WORKFLOW EXECUTOR] No targets found for branch node ${id} with handle "${handleKey}"`
              );
            }
          } else {
            console.log(
              `📋 [WORKFLOW EXECUTOR] Processing as regular node: ${id}, setting next = out (${out.length} edges)`
            );
            next = out;
            console.log(
              `➡️ [WORKFLOW EXECUTOR] Non-branch node ${id} will queue ${next.length} downstream nodes:`,
              next.map(e => e.target)
            );
          }


          // Add next nodes to queue
          console.log(`📝 [WORKFLOW EXECUTOR] About to queue ${next.length} edges from node ${id}`);
          next.forEach(e => {
            console.log(`🔄 [WORKFLOW EXECUTOR] Checking if target ${e.target} should be queued (currently in queue: ${queue.includes(e.target)})`);
            if (!queue.includes(e.target)) {
              queue.push(e.target);
              console.log(`✅ [WORKFLOW EXECUTOR] Added ${e.target} to queue. Queue length now: ${queue.length}`);
              // Mark conditional targets for explicit triggering
              if (isConditionalExecution) {
                console.log(`🎯 [WORKFLOW EXECUTOR] Marking conditional target ${e.target} for explicit execution`);
                retryCount.set(e.target + "_conditional", 1); // Use this as a flag
              }
            } else {
              console.log(`⚠️ [WORKFLOW EXECUTOR] Target ${e.target} already in queue, skipping`);
            }
          });
          console.log(`📋 [WORKFLOW EXECUTOR] Current queue after processing ${id}:`, queue);
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