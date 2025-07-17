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
  private context: ExecutionContext;
  private isAutoExecuting = false;

  constructor(context: ExecutionContext) {
    this.context = context;
  }

  /**
   * Topologically group nodes into parallelizable execution levels,
   * excluding targets of If-true/false edges.
   */
  getExecutionLevels(): string[][] {
    console.log('🔥 Building execution levels…');

    // 1) Identify nodes that only get triggered by If(true/false)
    const conditionalTargets = new Set<string>();
    this.context.edges.forEach(edge => {
      const src = this.context.nodes.find(n => n.id === edge.source);
      if (src?.data?.definition?.name === 'If' &&
          (edge.sourceHandle === 'true' || edge.sourceHandle === 'false')) {
        conditionalTargets.add(edge.target);
        console.log(`🚫 Excluding conditional target: ${edge.target}`);
      }
    });

    // 2) Build in-degree & adjacency for the rest
    const nodeIds = this.context.nodes
      .map(n => n.id)
      .filter(id => !conditionalTargets.has(id));

    const inDegree  = new Map<string, number>();
    const adjList   = new Map<string, string[]>();
    nodeIds.forEach(id => { inDegree.set(id, 0); adjList.set(id, []); });

    this.context.edges.forEach(edge => {
      const { source, target } = edge;
      if (adjList.has(source))   adjList.get(source)!.push(target);
      if (inDegree.has(target))  inDegree.set(target, inDegree.get(target)! + 1);
    });

    // 3) Kahn’s algorithm
    const levels: string[][] = [];
    const deg = new Map(inDegree);
    while (deg.size > 0) {
      const zero  = [...deg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
      if (zero.length === 0) {
        console.warn('⚠️ Circular dependency detected');
        break;
      }
      levels.push(zero);
      zero.forEach(id => {
        deg.delete(id);
        adjList.get(id)!.forEach(neigh => {
          if (deg.has(neigh)) deg.set(neigh, deg.get(neigh)! - 1);
        });
      });
    }

    console.log('🎯 Execution levels:', levels);
    return levels;
  }

  /**
   * Recursively execute from a given node, handling If-branches
   */
  async executeConditionalChain(
    startNodeId: string,
    completed: Set<string>
  ): Promise<void> {
    console.log(`🔄 Chain start: ${startNodeId}`);
    await new Promise<void>((resolve) => {
      const detail: NodeExecutionDetail = {
        nodeId: startNodeId,
        executedNodes: completed,
        allNodes: this.context.nodes,
        allEdges: this.context.edges,
        onSuccess: async (result?: any) => {
          completed.add(startNodeId);
          const nodeDef = this.context.nodes.find(n => n.id === startNodeId)
                              ?.data.definition;
          if (nodeDef?.name === 'If') {
            // Await whichever branch is taken
            await this.handleIfNodeResult(startNodeId, result, completed);
          } else {
            await this.executeDownstreamNodes(startNodeId, completed);
          }
          resolve();
        },
        onError: () => {
          console.error(`❌ Failed: ${startNodeId}`);
          resolve();  // swallow errors in chain
        }
      };

      window.dispatchEvent(new CustomEvent('auto-execute-node', { detail }));
    });
  }

  /**
   * Fire the correct true/false branch of an If node
   */
  private async handleIfNodeResult(
    nodeId: string,
    result: any,
    completed: Set<string>
  ): Promise<void> {
    const takeTrue = result?.true === true;
    console.log(`🔀 If ${nodeId} → ${takeTrue ? 'true' : 'false'}`);
    const outgoing = this.context.edges.filter(e => e.source === nodeId);
    const edge     = outgoing.find(e => e.sourceHandle === (takeTrue ? 'true' : 'false'));
    if (edge) {
      await this.executeConditionalChain(edge.target, completed);
    }
  }

  /**
   * Trigger all non-conditional downstream edges in parallel
   */
  private async executeDownstreamNodes(
    nodeId: string,
    completed: Set<string>
  ): Promise<void> {
    const downstream = this.context.edges.filter(e => {
      if (e.source !== nodeId) return false;
      const srcDef = this.context.nodes.find(n => n.id === nodeId)?.data.definition;
      // exclude If(true/false) handles
      return !(srcDef?.name === 'If' &&
               (e.sourceHandle === 'true' || e.sourceHandle === 'false'));
    });

    await Promise.all(
      downstream.map(e => this.executeConditionalChain(e.target, completed))
    );
  }

  /**
   * Execute a single node (visual highlight + event dispatch)
   */
  async executeNode(
    nodeId: string,
    completed: Set<string>
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // 1) highlight node & its edges
      this.context.setExecutingNode(nodeId);
      const connected = this.context.edges.filter(e => e.source === nodeId || e.target === nodeId);
      this.context.setEdges(ed =>
        ed.map(edge =>
          connected.some(c => c.id === edge.id)
            ? { ...edge, animated: true, className: 'executing-edge', style: {
                ...edge.style,
                stroke:      '#22c55e',
                strokeWidth: 3,
                strokeLinecap: 'round',
                strokeLinejoin:'round'
              }}
            : edge
        )
      );
      this.context.setNodes(nds =>
        nds.map(n =>
          n.id === nodeId
            ? { ...n, className: 'executing-node', style: {
                ...n.style,
                border:          '3px solid #22c55e',
                backgroundColor: '#f0fdf4',
                boxShadow:       '0 0 20px rgba(34,197,94,0.4)'
              } }
            : n
        )
      );

      // 2) dispatch event
      const detail: NodeExecutionDetail = {
        nodeId,
        executedNodes: completed,
        allNodes: this.context.nodes,
        allEdges: this.context.edges,
        onSuccess: async (res?: any) => {
          // After basic node logic, chain any conditionals
          const def = this.context.nodes.find(n => n.id === nodeId)?.data.definition;
          if (def?.name === 'If') {
            await this.handleIfNodeResult(nodeId, res, completed);
          }
          resolve();
        },
        onError: (err: any) => {
          console.error(`❌ Node ${nodeId} error:`, err);
          reject(err);
        }
      };
      window.dispatchEvent(new CustomEvent('auto-execute-node', { detail }));
    });
  }

  /**
   * Drive the full batch execution in topological order
   */
  async executeAllNodes(): Promise<void> {
    if (this.isAutoExecuting) return;
    const levels = this.getExecutionLevels();
    if (!levels.length || levels.every(l => !l.length)) {
      this.context.toast({ title: 'No Nodes', description: 'Nothing to execute', variant: 'destructive' });
      return;
    }

    this.isAutoExecuting = true;
    try {
      for (let i = 0; i < levels.length; i++) {
        const lvl = levels[i];
        if (!lvl.length) continue;

        console.log(`🔥 Level ${i+1}: [${lvl.join(', ')}]`);
        // Build the completed set up to this point
        const done = new Set<string>();
        for (let j = 0; j < i; j++) levels[j].forEach(id => done.add(id));

        // Run them all in parallel (each will fan out into conditionals)
        await Promise.all(lvl.map(id => this.executeNode(id, done)));
        console.log(`✅ Level ${i+1} done`);
      }
      this.context.toast({ title: 'Execution Complete', description: 'All nodes ran successfully' });
    } catch (err) {
      console.error('❌ Execution failure:', err);
      this.context.toast({
        title: 'Execution Failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      this.isAutoExecuting = false;
      this.context.setExecutingNode(null);

      // Reset visuals
      this.context.setEdges(ed =>
        ed.map(e => ({ ...e, animated: false, className: '', style: {} }))
      );
      this.context.setNodes(nds =>
        nds.map(n => ({ ...n, className: '', style: {} }))
      );
    }
  }

  /** For external control if needed */
  setAutoExecuting(value: boolean) { this.isAutoExecuting = value; }
  getIsAutoExecuting(): boolean { return this.isAutoExecuting; }
}
