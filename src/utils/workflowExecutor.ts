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
    // Reset state
    this.executed.clear();
    this.ctx.setExecutingNode(null);

    const queue = this.getRootNodeIds().slice();
    if (queue.length === 0) {
      this.ctx.toast({
        title: 'No start nodes',
        description: 'No entry points found',
        variant: 'destructive',
      });
      return;
    }

    while (queue.length) {
      const nodeId = queue.shift()!;
      if (this.executed.has(nodeId)) {
        continue; // skip already-run
      }
      this.executed.add(nodeId);

      // Highlight current node
      this.ctx.setExecutingNode(nodeId);

      let result: any = {};
      try {
        result = await this.executeNode(nodeId);
      } catch (err) {
        // onError inside executeNode already toasts
        continue;
      }

      // Determine next nodes
      const srcDef = this.ctx.nodes.find(n => n.id === nodeId)?.data?.definition as any;
      const outgoing = this.ctx.edges.filter(e => e.source === nodeId);
      if (srcDef?.name === 'If') {
        // follow only the matching handle
        const takeTrue = !!result.true;
        outgoing
          .filter(e => e.sourceHandle === (takeTrue ? 'true' : 'false'))
          .forEach(e => queue.push(e.target));
      } else {
        // follow all outgoing
        outgoing.forEach(e => queue.push(e.target));
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