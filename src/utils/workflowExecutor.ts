import { Node, Edge } from '@xyflow/react';

export interface ExecutionContext {
  nodes: Node[];
  edges: Edge[];
  setNodes: (update: (nodes: Node[]) => Node[]) => void;
  setEdges: (update: (edges: Edge[]) => Edge[]) => void;
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
  private context: ExecutionContext;
  private isAutoExecuting = false;

  constructor(context: ExecutionContext) {
    this.context = context;
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
   * Handle If node result and execute appropriate conditional path
   */
  private async handleIfNodeResult(
    nodeId: string,
    result: any,
    completedNodes: Set<string>
  ): Promise<void> {
    const condition = !!result;
    console.log(`🔀 If node ${nodeId} branch: ${condition}`);

    const outgoing = this.context.edges.filter(e => e.source === nodeId);
    const activeEdge = condition
      ? outgoing.find(e => e.sourceHandle === 'true')
      : outgoing.find(e => e.sourceHandle === 'false');

    if (activeEdge) {
      console.log(`👉 Executing branch to ${activeEdge.target}`);
      await this.executeConditionalChain(activeEdge.target, completedNodes);
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
   * Execute all nodes using a FIFO queue, respecting dependencies and branching
   */
  async executeAllNodes(): Promise<void> {
    console.log('🚀 Starting FIFO queue‑based workflow execution');

    if (this.isAutoExecuting) {
      console.log('⚠️ FIFO queue‑based execution already in progress');
      return;
    }
    this.isAutoExecuting = true;

    const executed = new Set<string>();
    const roots = this.context.nodes
      .filter(n => !this.context.edges.some(e => e.target === n.id))
      .map(n => n.id);
    const queue: string[] = [...roots];

    try {
      while (queue.length) {
        const id = queue.shift()!;
        if (executed.has(id)) continue;

        const inc = this.context.edges.filter(e => e.target === id);
        const missing = inc.filter(e => !executed.has(e.source));
        if (missing.length) {
          queue.push(id);
          continue;
        }

        const result = await this.executeNode(id, executed);
        executed.add(id);

        const out = this.context.edges.filter(e => e.source === id);
        const node = this.context.nodes.find(n => n.id === id);
        const next =
          node?.data.definition.name === 'If'
            ? [(result ? out.find(e => e.sourceHandle === 'true') : out.find(e => e.sourceHandle === 'false'))].filter(Boolean)
            : out;

        next.forEach(e => queue.push(e.target));
      }

      console.log('🎉 FIFO queue‑based execution complete');
      this.context.toast({ title: 'Queue Execution Complete', description: 'All workflow nodes executed successfully' });
    } catch (err) {
      console.error('❌ FIFO queue‑based execution error:', err);
      this.context.toast({ title: 'Queue Execution Error', description: err.message || String(err), variant: 'destructive' });
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
