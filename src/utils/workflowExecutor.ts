// src/utils/WorkflowExecutor.ts

import { Node, Edge } from '@xyflow/react';

export interface ExecutionContext {
  nodes: Node[];
  edges: Edge[];
  setNodes: (updater: (nodes: Node[]) => Node[]) => void;
  setEdges: (updater: (edges: Edge[]) => Edge[]) => void;
  setExecutingNode: (nodeId: string | null) => void;
  toast: (params: any) => void;
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
  private ctx: ExecutionContext;
  private executed = new Set<string>();

  constructor(context: ExecutionContext) {
    this.ctx = context;
  }

  /**
   * Find all "root" nodes: those with no incoming non-conditional edges.
   * These are where we start our queue.
   */
  private getRootNodeIds(): string[] {
    const conditionalTargets = new Set(
      this.ctx.edges
        .filter(e => {
          const srcDef = this.ctx.nodes.find(n => n.id === e.source)?.data?.definition as any;
          return srcDef?.name === 'If' &&
                 (e.sourceHandle === 'true' || e.sourceHandle === 'false');
        })
        .map(e => e.target)
    );

    const nonConditionalIncomings = new Map<string, number>();
    this.ctx.nodes.forEach(n => nonConditionalIncomings.set(n.id, 0));

    this.ctx.edges.forEach(e => {
      // skip conditional handles
      const srcDef = this.ctx.nodes.find(n => n.id === e.source)?.data?.definition as any;
      const isCond = srcDef?.name === 'If' &&
                     (e.sourceHandle === 'true' || e.sourceHandle === 'false');
      if (!isCond && nonConditionalIncomings.has(e.target)) {
        nonConditionalIncomings.set(e.target, nonConditionalIncomings.get(e.target)! + 1);
      }
    });

    // roots = those with zero non-conditional incoming edges
    return [...nonConditionalIncomings.entries()]
      .filter(([, deg]) => deg === 0)
      .map(([id]) => id);
  }

  /**
   * Run the entire workflow dynamically.
   * Starts from all root nodes.
   */
  async executeAllNodes(): Promise<void> {
    console.log('🚀 Starting workflow execution...');
    
    // Reset state
    this.executed.clear();
    this.ctx.setExecutingNode(null);

    const queue = this.getRootNodeIds().slice();
    console.log('📋 Root nodes found:', queue);
    
    if (queue.length === 0) {
      console.log('❌ No root nodes found');
      this.ctx.toast({
        title: 'No start nodes',
        description: 'No entry points found',
        variant: 'destructive',
      });
      return;
    }

    while (queue.length) {
      const nodeId = queue.shift()!;
      console.log(`🔄 Processing node: ${nodeId}`);
      
      if (this.executed.has(nodeId)) {
        console.log(`⏭️ Skipping already executed node: ${nodeId}`);
        continue; // skip already-run
      }

      // Check if all dependencies are satisfied for this node
      if (!this.areNodeDependenciesSatisfied(nodeId)) {
        console.log(`⏳ Node ${nodeId} dependencies not satisfied, re-queuing`);
        queue.push(nodeId); // Re-queue for later
        continue;
      }
      this.executed.add(nodeId);

      // Highlight current node
      this.ctx.setExecutingNode(nodeId);
      console.log(`✨ Executing node: ${nodeId}`);

      let result: any = {};
      try {
        result = await this.executeNode(nodeId);
        console.log(`✅ Node ${nodeId} completed with result:`, result);
      } catch (err) {
        console.error(`❌ Node ${nodeId} failed:`, err);
        // onError inside executeNode already toasts
        continue;
      }

      // Determine next nodes
      const srcDef = this.ctx.nodes.find(n => n.id === nodeId)?.data?.definition as any;
      const outgoing = this.ctx.edges.filter(e => e.source === nodeId);
      console.log(`🔍 Node ${nodeId} outgoing edges:`, outgoing.length);
      
      if (srcDef?.name === 'If') {
        // follow only the matching handle
        const takeTrue = !!result.true;
        console.log(`🔀 If node ${nodeId} taking ${takeTrue ? 'TRUE' : 'FALSE'} path`);
        const nextNodes = outgoing
          .filter(e => e.sourceHandle === (takeTrue ? 'true' : 'false'))
          .map(e => e.target);
        console.log(`➡️ Adding conditional targets to queue:`, nextNodes);
        nextNodes.forEach(target => queue.push(target));
      } else {
        // follow all outgoing
        const nextNodes = outgoing.map(e => e.target);
        console.log(`➡️ Adding ${nextNodes.length} targets to queue:`, nextNodes);
        nextNodes.forEach(target => queue.push(target));
      }
    }

    // Cleanup UI state
    this.ctx.setExecutingNode(null);
    this.ctx.toast({
      title: 'Execution Complete',
      description: 'All runnable nodes have executed.',
    });
  }

  /**
   * Check if all non-conditional dependencies of a node are satisfied
   */
  private areNodeDependenciesSatisfied(nodeId: string): boolean {
    const incomingEdges = this.ctx.edges.filter(e => e.target === nodeId);
    
    for (const edge of incomingEdges) {
      const srcDef = this.ctx.nodes.find(n => n.id === edge.source)?.data?.definition as any;
      
      // Skip conditional edges (If true/false handles)
      const isConditional = srcDef?.name === 'If' && 
                           (edge.sourceHandle === 'true' || edge.sourceHandle === 'false');
      
      if (!isConditional && !this.executed.has(edge.source)) {
        console.log(`❌ Node ${nodeId} missing dependency: ${edge.source}`);
        return false;
      }
    }
    
    return true;
  }

  /**
   * Execute one node by dispatching the custom event.
   * Resolves with the node's "result" payload.
   */
  private executeNode(nodeId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const detail: NodeExecutionDetail = {
        nodeId,
        executedNodes: new Set(this.executed),
        allNodes: this.ctx.nodes,
        allEdges: this.ctx.edges,
        explicitlyTriggered: true,
        onSuccess: (res?: any) => resolve(res || {}),
        onError: (err: any) => {
          console.error(`Node ${nodeId} failed:`, err);
          this.ctx.toast({
            title: 'Node Error',
            description: err?.message || String(err),
            variant: 'destructive',
          });
          // resolve empty so the queue continues
          resolve({});
        },
      };

      window.dispatchEvent(new CustomEvent('auto-execute-node', { detail }));
    });
  }

  /** Optional: expose whether an execution is in flight */
  isExecuting(): boolean {
    return this.executed.size > 0;
  }

  /** Legacy compatibility method */
  getIsAutoExecuting(): boolean {
    return this.isExecuting();
  }
}