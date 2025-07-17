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
  private maxIterations = 100; // Safety limit

  constructor(context: ExecutionContext) {
    this.ctx = context;
  }

  /**
   * Find all nodes that can execute right now (dependencies satisfied)
   */
  private getReadyNodes(): string[] {
    const readyNodes: string[] = [];
    
    for (const node of this.ctx.nodes) {
      // Skip already executed nodes
      if (this.executed.has(node.id)) continue;
      
      // Check if all dependencies are satisfied
      if (this.areNodeDependenciesSatisfied(node.id)) {
        readyNodes.push(node.id);
      }
    }
    
    console.log(`🎯 Ready nodes found: [${readyNodes.join(', ')}]`);
    return readyNodes;
  }

  /**
   * Check if all non-conditional dependencies of a node are satisfied
   */
  private areNodeDependenciesSatisfied(nodeId: string): boolean {
    const incomingEdges = this.ctx.edges.filter(e => e.target === nodeId);
    
    for (const edge of incomingEdges) {
      const srcDef = this.ctx.nodes.find(n => n.id === edge.source)?.data?.definition as any;
      
      // Skip conditional edges (If true/false handles) - these don't count as dependencies
      const isConditional = srcDef?.name === 'If' && 
                           (edge.sourceHandle === 'true' || edge.sourceHandle === 'false');
      
      if (!isConditional && !this.executed.has(edge.source)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Run the entire workflow dynamically.
   */
  async executeAllNodes(): Promise<void> {
    console.log('🚀 [WORKFLOW EXECUTOR] Starting workflow execution...');
    console.log('🚀 [WORKFLOW EXECUTOR] Total nodes:', this.ctx.nodes.length);
    console.log('🚀 [WORKFLOW EXECUTOR] Total edges:', this.ctx.edges.length);
    
    // Reset state
    this.executed.clear();
    this.ctx.setExecutingNode(null);

    let iterations = 0;
    
    while (iterations < this.maxIterations) {
      iterations++;
      console.log(`\n🔄 Iteration ${iterations}`);
      
      // Find all nodes that are ready to execute
      const readyNodes = this.getReadyNodes();
      
      // If no nodes are ready, we're done (or stuck)
      if (readyNodes.length === 0) {
        const remainingNodes = this.ctx.nodes
          .filter(n => !this.executed.has(n.id))
          .map(n => n.id);
          
        if (remainingNodes.length > 0) {
          console.log(`⚠️ Workflow stuck. Remaining nodes: [${remainingNodes.join(', ')}]`);
          this.ctx.toast({
            title: 'Workflow Incomplete',
            description: `${remainingNodes.length} nodes couldn't execute due to missing dependencies`,
            variant: 'destructive',
          });
        } else {
          console.log('✅ All nodes executed successfully');
          this.ctx.toast({
            title: 'Execution Complete',
            description: 'All nodes executed successfully',
          });
        }
        break;
      }
      
      // Execute all ready nodes in parallel
      console.log(`🚀 Executing ${readyNodes.length} ready nodes in parallel...`);
      
      try {
        await Promise.all(readyNodes.map(nodeId => this.executeNodeWithHandling(nodeId)));
      } catch (error) {
        console.error('❌ Execution batch failed:', error);
        break;
      }
    }
    
    if (iterations >= this.maxIterations) {
      console.log('⚠️ Maximum iterations reached - possible infinite loop');
      this.ctx.toast({
        title: 'Execution Timeout',
        description: 'Workflow execution stopped due to complexity limits',
        variant: 'destructive',
      });
    }

    // Cleanup UI state
    this.ctx.setExecutingNode(null);
  }

  /**
   * Execute a single node and handle If-node branching
   */
  private async executeNodeWithHandling(nodeId: string): Promise<void> {
    console.log(`✨ Executing node: ${nodeId}`);
    
    // Mark as executed before starting (prevents re-execution)
    this.executed.add(nodeId);
    
    // Highlight current node
    this.ctx.setExecutingNode(nodeId);
    
    try {
      const result = await this.executeNode(nodeId);
      console.log(`✅ Node ${nodeId} completed with result:`, result);
      
      // Handle If-node conditional execution
      const srcDef = this.ctx.nodes.find(n => n.id === nodeId)?.data?.definition as any;
      if (srcDef?.name === 'If') {
        await this.handleIfNodeConditionalExecution(nodeId, result);
      }
      
    } catch (error) {
      console.error(`❌ Node ${nodeId} failed:`, error);
      // Don't remove from executed set - failed nodes shouldn't retry automatically
    }
  }

  /**
   * Handle conditional execution for If nodes
   */
  private async handleIfNodeConditionalExecution(nodeId: string, result: any): Promise<void> {
    const takeTrue = !!result.true;
    console.log(`🔀 If node ${nodeId} taking ${takeTrue ? 'TRUE' : 'FALSE'} path`);
    
    const conditionalEdges = this.ctx.edges.filter(e => 
      e.source === nodeId && 
      e.sourceHandle === (takeTrue ? 'true' : 'false')
    );
    
    if (conditionalEdges.length > 0) {
      console.log(`🎯 If node triggering conditional targets: [${conditionalEdges.map(e => e.target).join(', ')}]`);
      
      // Execute conditional targets immediately
      for (const edge of conditionalEdges) {
        if (!this.executed.has(edge.target)) {
          await this.executeNodeWithHandling(edge.target);
        }
      }
    }
  }

  /**
   * Execute one node by dispatching the custom event.
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
          reject(err);
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