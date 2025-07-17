import { Node, Edge } from '@xyflow/react';

export interface ExecutionContext {
  nodes: Node[];
  edges: Edge[];
  setNodes: (update: (nodes: Node[]) => Node[]) => void;
  setEdges: (update: (edges: Edge[]) => Edge[]) => void;
  setExecutingNode: (nodeId: string | null) => void;
  toast: (params: any) => void;
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
  onSuccess?: (result?: any) => void;
  onError?: (error: any) => void;
}

export class WorkflowExecutor {
  private context: ExecutionContext;
  private isAutoExecuting = false;
  private conditionalMap = new Map<string, { trueTarget?: string, falseTarget?: string }>();

  constructor(context: ExecutionContext) {
    this.context = context;
    this.preCalculateConditionalBranches();
  }

  /**
   * Pre-calculate conditional branches for optimization
   */
  private preCalculateConditionalBranches(): void {
    this.conditionalMap.clear();
    this.context.edges.forEach(edge => {
      const sourceNode = this.context.nodes.find(n => n.id === edge.source);
      if ((sourceNode?.data?.definition as any)?.name === 'If') {
        const entry = this.conditionalMap.get(edge.source) || {};
        if (edge.sourceHandle === 'true') entry.trueTarget = edge.target;
        if (edge.sourceHandle === 'false') entry.falseTarget = edge.target;
        this.conditionalMap.set(edge.source, entry);
      }
    });
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

            if ((currentNode?.data?.definition as any)?.name === 'If') {
              await this.handleIfNodeResult(startNodeId, result, completedNodes);
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
   * Handle If node result and execute appropriate conditional path (optimized)
   */
  private async handleIfNodeResult(
    nodeId: string,
    result: any,
    completedNodes: Set<string>
  ): Promise<void> {
    const condition = !!result;
    console.log(`🔀 If node ${nodeId} branch: ${condition}`);

    const conditionalBranch = this.conditionalMap.get(nodeId);
    const targetNodeId = condition ? conditionalBranch?.trueTarget : conditionalBranch?.falseTarget;

    if (targetNodeId) {
      console.log(`👉 Executing optimized branch to ${targetNodeId}`);
      await this.executeConditionalChain(targetNodeId, completedNodes);
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
      const sourceNode = this.context.nodes.find(n => n.id === e.source);
      const isCond = sourceNode && (sourceNode.data?.definition as any)?.name === 'If';
      return !isCond;
    });

    const tasks = downstream.map(e => {
      console.log(`🔄 Triggering downstream: ${e.target}`);
      return this.executeConditionalChain(e.target, completedNodes);
    });

    await Promise.all(tasks);
  }

  /**
   * Highlight edges connected to a node
   */
  private highlightEdges(nodeId: string): void {
    const connected = this.context.edges.filter(
      e => e.source === nodeId || e.target === nodeId
    );
    this.context.setEdges(edges =>
      edges.map(edge =>
        connected.some(c => c.id === edge.id)
          ? { ...edge, animated: true, className: 'executing-edge', style: { ...edge.style, stroke: '#22c55e', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' } }
          : edge
      )
    );
  }

  /**
   * Highlight a node
   */
  private highlightNode(nodeId: string): void {
    this.context.setNodes(nodes =>
      nodes.map(n =>
        n.id === nodeId
          ? { ...n, className: 'executing-node', style: { ...n.style, border: '3px solid #22c55e', backgroundColor: '#f0fdf4', boxShadow: '0 0 20px rgba(34,197,94,0.4)' } }
          : n
      )
    );
  }

  /**
   * Execute a single node with visual feedback
   */
  async executeNode(
    nodeId: string,
    executedNodes: Set<string>
  ): Promise<any> {
    this.context.setExecutingNode(nodeId);
    this.highlightEdges(nodeId);
    this.highlightNode(nodeId);

    return new Promise<any>((resolve, reject) => {
      const execEvent = new CustomEvent('auto-execute-node', {
        detail: {
          nodeId,
          executedNodes,
          allNodes: this.context.nodes,
          allEdges: this.context.edges,
          onSuccess: (result?: any) => resolve(result),
          onError: (err: any) => reject(err)
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

    // Check for cycles first
    if (this.detectCycles()) {
      const error = 'Circular dependency detected in workflow';
      console.error(`❌ [WORKFLOW EXECUTOR] ${error}`);
      this.context.toast({ title: 'Workflow Error', description: error, variant: 'destructive' });
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
          const result = await this.executeNode(id, executed);
          const nodeTime = performance.now() - nodeStart;
          metrics.nodeTimings.set(id, nodeTime);
          
          executed.add(id);
          metrics.completedNodes.add(id);
          console.log(`✅ [WORKFLOW EXECUTOR] Node ${id} completed in ${nodeTime.toFixed(2)}ms`);

          const out = this.context.edges.filter(e => e.source === id);
          const node = this.context.nodes.find(n => n.id === id);
          
          // Use optimized conditional branch handling
          let next: Edge[] = [];
          if ((node?.data?.definition as any)?.name === 'If') {
            const conditionalBranch = this.conditionalMap.get(id);
            const targetNodeId = result ? conditionalBranch?.trueTarget : conditionalBranch?.falseTarget;
            if (targetNodeId) {
              const targetEdge = out.find(e => e.target === targetNodeId);
              if (targetEdge) next = [targetEdge];
            }
          } else {
            next = out;
          }

          next.forEach(e => {
            if (!queue.includes(e.target)) {
              queue.push(e.target);
            }
          });
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
