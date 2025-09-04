import { WorkflowNode, WorkflowEdge, QueueItem, IterMeta } from '../nodes/types';
import { QueueManager } from './queueManagerV2';
import { NodeRouter } from './router';
import { NodeStoreV2 } from './nodeStoreV2';
import { getNodeExecutor } from '../nodes/registry';
import { resolveReferences } from '../utils/resolveReferences';

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

export class WorkflowEngine {
  private router: NodeRouter;
  private queue: QueueManager;
  private store: NodeStoreV2;
  private executors: Map<string, any> = new Map();
  private edgePayload = new Map<string, any>();
  private executed = new Set<string>();
  private failed = new Set<string>();
  private enqueuedKeys = new Set<string>();
  private retryCount = new Map<string, number>();
  private MAX_RETRIES = 0;
  private conditionalMap = new Map<string, Record<string, string[]>>();
  private mode: 'best-effort' | 'fail-fast';

  constructor(
    private runId: string,
    private workflowId: string,
    private userId: string,
    private nodes: WorkflowNode[],
    private edges: WorkflowEdge[],
    mode: 'best-effort' | 'fail-fast' = 'best-effort'
  ) {
    this.router = new NodeRouter(edges);
    // Add node type lookup to router
    (this.router as any).getSourceNodeType = (nodeId: string) => {
      const node = this.nodes.find(n => n.id === nodeId);
      return node?.type;
    };
    this.queue = new QueueManager();
    this.store = new NodeStoreV2(runId, nodes);
    this.mode = mode;
  }

  // Deep resolve helper for resolving template expressions recursively
  private resolveDeep(
    val: any,
    input: any,
    allNodeData: Record<string, any>
  ): any {
    if (typeof val === 'string' && val.includes('{{')) {
      const resolved = resolveReferences(val, input, allNodeData, this.nodes);
      // If resolveReferences returned non-string, return it directly
      return resolved;
    }
    if (Array.isArray(val)) {
      return val.map(item => this.resolveDeep(item, input, allNodeData));
    }
    if (val !== null && typeof val === 'object') {
      return Object.fromEntries(
        Object.entries(val).map(
          ([k, v]) => [k, this.resolveDeep(v, input, allNodeData)]
        )
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
      if (key === 'credential_id' || key === 'operation') continue;
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
      ? `@loop:${item.meta.originLoopId}:${item.meta.iterIndex ?? 'na'}`
      : '';
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
    this.edges.filter(e => e.target === targetId);

  private isLoopNode = (nodeId: string) => {
    const n = this.nodes.find(x => x.id === nodeId);
    return n?.type === 'Loop';
  };

  private isBranchNode = (nodeId: string) => {
    const n = this.nodes.find(x => x.id === nodeId);
    return n?.type === 'If' || n?.type === 'Switch';
  };

  private areDependenciesSatisfied(nodeId: string): boolean {
    if (this.isLoopNode(nodeId)) {
      const loopNode = this.nodes.find(n => n.id === nodeId);
      const loopWaits = Boolean((loopNode as any)?.values?.loopWaits);
      if (!loopWaits) return true;
    }

    const required = this.getIncomingEdges(nodeId);
    if (required.length === 0) return false;
    return required.every(e => this.edgePayload.has(e.id));
  }

  private markEdgePayload(edgeId: string, payload: any) {
    this.edgePayload.set(edgeId, payload);
  }

  private clearIncomingEdgePayloads(nodeId: string) {
    for (const e of this.getIncomingEdges(nodeId)) this.edgePayload.delete(e.id);
  }

  private async executeConditionalChain(
    nodeId: string,
    input: any,
    meta?: IterMeta
  ): Promise<void> {
    await this.executeOnce({ nodeId, input, meta });
  }

  private async routeEdge(
    edge: WorkflowEdge,
    payload: any,
    meta?: IterMeta
  ): Promise<void> {
    this.markEdgePayload(edge.id, payload);
    if (!this.areDependenciesSatisfied(edge.target)) return;

    const target = this.nodes.find(n => n.id === edge.target);
    if (target && this.isBranchNode(edge.target)) {
      await this.executeConditionalChain(edge.target, payload, meta);
    } else {
      this.enqueue({ nodeId: edge.target, input: payload, meta });
    }
  }

  private preCalculateConditionalBranches() {
    this.conditionalMap.clear();
    for (const e of this.edges) {
      const src = this.nodes.find(n => n.id === e.source);
      if (!src) continue;
      if (!(src.type === 'If' || src.type === 'Switch')) continue;
      if (!e.sourceHandle) continue;

      const entry = this.conditionalMap.get(e.source) || {};
      entry[e.sourceHandle] = [...(entry[e.sourceHandle] || []), e.target];
      this.conditionalMap.set(e.source, entry);
    }
  }

  private detectCycles(): boolean {
    const visited = new Set<string>();
    const inPath = new Set<string>();
    const nexts = (id: string) =>
      this.edges.filter(e => e.source === id).map(e => e.target);

    const hasCycle = (id: string): boolean => {
      if (inPath.has(id)) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      inPath.add(id);
      for (const t of nexts(id)) if (hasCycle(t)) return true;
      inPath.delete(id);
      return false;
    };

    for (const n of this.nodes) {
      if (!visited.has(n.id) && hasCycle(n.id)) return true;
    }
    return false;
  }

  async execute(initialInput?: any, backtestContext?: any): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      console.log(`🚀 [WORKFLOW] Starting V2 workflow execution for run ${this.runId}`);
      this.MAX_RETRIES = this.nodes.length * 2;
      this.preCalculateConditionalBranches();
      if (this.detectCycles()) {
        return { success: false, error: 'Cycle detected in workflow graph' };
      }

      await this.run(initialInput, backtestContext);

      console.log(`✅ Workflow execution completed successfully`);
      return { success: true, result: this.store.getAllResults() };
    } catch (error) {
      console.error('❌ Workflow execution failed:', error);
      const message = (error as Error).message;
      return { success: false, error: message };
    }
  }

  async run(initialInput: any = [], backtestContext?: any): Promise<void> {
    // Find entry nodes (no incoming edges)
    const entryNodes = this.nodes.filter(n => !this.edges.some(e => e.target === n.id));

    // Seed queue with entry nodes
    for (const node of entryNodes) {
      this.enqueue({ nodeId: node.id, input: initialInput });
    }

    // Process queue until empty
    while (this.queue.length > 0) {
      const item = this.dequeue();
      if (!item) break;
      await this.executeOnce(item, backtestContext);
    }
  }

  private async executeOnce(item: QueueItem, backtestContext?: any): Promise<void> {
    const { nodeId, input, meta } = item;
    const node = this.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // FE-style retry guard when dependencies are missing
    const incoming = this.getIncomingEdges(nodeId);
    if (incoming.length > 0 && !this.areDependenciesSatisfied(nodeId)) {
      const tries = this.retryCount.get(nodeId) || 0;
      if (tries >= this.MAX_RETRIES) {
        this.failed.add(nodeId);
        this.store.setNodeError(nodeId, new Error(`Dependency not satisfied after ${this.MAX_RETRIES} retries`));
        return;
      }
      this.retryCount.set(nodeId, tries + 1);
      this.enqueue(item);
      return;
    }

    try {
      const fullResult = await this.executeNode(node, input, backtestContext);
      const result = fullResult?.data || fullResult;
      console.log(`✅ Node ${nodeId} result:`, result);

      this.store.setNodeResult(nodeId, result);
      this.executed.add(nodeId);

      if (node.type === 'Loop' && fullResult && typeof fullResult === 'object') {
        if (fullResult.meta?.isLoopCompleted) {
          const doneEdges = this.router.doneEdges(nodeId);
          for (const edge of doneEdges) {
            await this.routeEdge(edge, result, meta);
          }
        } else if (fullResult.meta?.isLoopIteration) {
          const loopEdges = this.router.loopBodyEdges(nodeId);
          for (const edge of loopEdges) {
            const iterMeta: IterMeta = {
              ...(meta || {}),
              originLoopId: nodeId,
              iterIndex: fullResult.meta.currentIndex
            };
            await this.routeEdge(edge, result, iterMeta);
          }
        }
        return; // don't clear loop node payloads
      }

      const edges = this.router.select(nodeId, result);
      console.log(`🎯 Routing from ${nodeId} via ${edges.length} edges`);

      if (meta?.originLoopId) {
        const loopNodeId = meta.originLoopId;
        const loopNode = this.nodes.find(n => n.id === loopNodeId);
        const hasActiveEdgeToLoop = edges.some(e => e.target === loopNodeId);
        if (loopNode?.type === 'Loop' && hasActiveEdgeToLoop) {
          const currentResults = this.store.getNodeState(loopNodeId, 'aggregatedResults') || [];
          currentResults.push(result);
          this.store.setNodeState(loopNodeId, 'aggregatedResults', currentResults);
        }
      }

      for (const edge of edges) {
        await this.routeEdge(edge, result, meta);
      }

      this.clearIncomingEdgePayloads(nodeId);
    } catch (error) {
      console.error(`❌ Node ${nodeId} failed:`, error);
      this.failed.add(nodeId);
      this.store.setNodeError(nodeId, error);

      if (meta?.originLoopId) {
        const loopNode = this.nodes.find(n => n.id === meta.originLoopId);
        const config = loopNode?.values || {};
        if (config.continueOnError) {
          const currentResults = this.store.getNodeState(meta.originLoopId, 'aggregatedResults') || [];
          currentResults.push({ error: (error as any).message });
          this.store.setNodeState(meta.originLoopId, 'aggregatedResults', currentResults);
          this.enqueue({ nodeId: meta.originLoopId, input: {}, meta: {} });
          return;
        }
      }

      if (this.mode === 'fail-fast') {
        throw error;
      }
      // best-effort: swallow error
    }
  }

  private async executeNode(node: WorkflowNode, input: any, backtestContext?: any): Promise<any> {
    console.log(`🔧 Executing node ${node.id} (${node.type})`);

    // Map node categories for compatibility
    let category = node.category;
    if (node.type === 'If' || node.type === 'Switch' || node.type === 'Edit Fields' || node.type === 'Math' || node.type === 'Transform' || node.type === 'Loop') {
      category = 'ControlFlow';
    } else if (['Scheduler', 'trigger', 'Visualize', 'webhook', 'httprequest'].includes(node.type)) {
      category = 'Utility';
    } else if (['Gmail', 'WhatsApp'].includes(node.type)) {
      category = 'Communication';
    } else if (['FinnHub', 'YahooFinance'].includes(node.type)) {
      category = 'DataSource';
    }

    // Use custom executor if registered, otherwise get from registry
    let executor = this.executors.get(category);
    if (!executor) {
      executor = getNodeExecutor(category);
    }

    if (!executor) {
      throw new Error(`Unsupported node category: ${category} for node type: ${node.type}`);
    }

    // Create execution context with backtest support
    const context: ExecutionContext = {
      nodeId: node.id,
      runId: this.runId,
      workflowId: this.workflowId,
      userId: this.userId,
      getState: (key: string) => this.store.getNodeState(node.id, key),
      setState: (key: string, value: any) => this.store.setNodeState(node.id, key, value),
      getPersistentValue: (key: string) => this.store.getPersistentValue(this.workflowId, key),
      setPersistentValue: (key: string, value: any) => this.store.setPersistentValue(this.workflowId, key, value),
      resolveNodeParameters: backtestContext?.resolveNodeParameters?.bind(backtestContext) || 
        ((node: WorkflowNode, input: any) => this.resolveNodeParameters(node, input))
    };

    // Execute node
    const result = await executor.execute(node, input, context);
    
    if (result && typeof result === 'object' && 'success' in result) {
      if (!result.success) {
        throw new Error(result.error || `Node execution failed: ${category}`);
      }
      // Return full result structure to preserve metadata
      return { data: result.data, meta: result.meta };
    }

    // For simple results, wrap in structure to maintain consistency
    return { data: result };
  }
}

/**
 * Factory function to execute a workflow
 */
export type ExecutionOptions = {
  mode?: 'best-effort' | 'fail-fast';
};

export async function executeWorkflow(
  runId: string,
  workflowId: string,
  userId: string,
  nodes: any[],
  edges: any[],
  opts?: ExecutionOptions
): Promise<{ success: boolean; result?: any; error?: string }> {
  const workflowEngine = new WorkflowEngine(runId, workflowId, userId, nodes, edges, opts?.mode);
  return await workflowEngine.execute();
}