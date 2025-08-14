import { WorkflowNode, WorkflowEdge, QueueItem, IterMeta } from '../nodes/types';
import { QueueManager } from './queueManagerV2';
import { NodeRouter } from './router';
import { LoopHandler } from './loopHandler';
import { NodeStoreV2 } from './nodeStoreV2';
import { getNodeExecutor } from '../nodes/registry';

interface ExecutionContext {
  nodeId: string;
  runId: string;
  workflowId: string;
  userId: string;
  getState: (key: string) => any;
  setState: (key: string, value: any) => void;
  getPersistentValue: (key: string) => Promise<any>;
  setPersistentValue: (key: string, value: any) => Promise<void>;
}

export class WorkflowEngine {
  private router: NodeRouter;
  private queue: QueueManager;
  private loopHandler: LoopHandler;
  private store: NodeStoreV2;
  private executors: Map<string, any> = new Map();

  constructor(
    private runId: string,
    private workflowId: string,
    private userId: string,
    private nodes: WorkflowNode[],
    private edges: WorkflowEdge[]
  ) {
    this.router = new NodeRouter(edges);
    this.queue = new QueueManager();
    this.store = new NodeStoreV2(runId, nodes);
    this.loopHandler = new LoopHandler(this.store, this.router, this.queue);
  }

  registerExecutor(category: string, executor: any) {
    this.executors.set(category, executor);
  }

  async execute(initialInput?: any): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      console.log(`🚀 [WORKFLOW] Starting V2 workflow execution for run ${this.runId}`);
      
      await this.run(initialInput);
      
      console.log(`✅ Workflow execution completed successfully`);
      return { success: true, result: this.store.getAllResults() };
    } catch (error) {
      console.error('❌ Workflow execution failed:', error);
      const message = (error as Error).message;
      return { success: false, error: message };
    }
  }

  async run(initialInput: any = []): Promise<void> {
    // Find entry nodes (no incoming edges)
    const entryNodes = this.nodes.filter(n => !this.edges.some(e => e.target === n.id));
    
    // Seed queue with entry nodes
    for (const node of entryNodes) {
      this.queue.enqueue({ nodeId: node.id, input: initialInput });
    }

    // Process queue until empty
    while (this.queue.length > 0) {
      const item = this.queue.dequeue();
      if (!item) break;
      await this.executeOnce(item);
    }
  }

  private async executeOnce(item: QueueItem): Promise<void> {
    const { nodeId, input, meta } = item;
    const node = this.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Track this task for loop refcount
    this.queue.inc(meta?.originLoopId, meta?.iterIndex);

    try {
      if (node.type === 'Loop') {
        // Loop handler manages its own ticking
        await this.loopHandler.tick(nodeId, input);
        return;
      }

      // Execute regular node
      const result = await this.executeNode(node, input);
      this.store.setNodeResult(nodeId, result);

      // Route based on result and branch handles
      const edgesToFire = this.router.select(nodeId, result);
      for (const edge of edgesToFire) {
        const targetNode = this.nodes.find(n => n.id === edge.target);
        if (targetNode?.type === 'Loop') {
          // Buffer feedback to Loop, don't execute immediately
          this.store.bufferToLoop(edge.target, edge.id, result);
        } else {
          // Normal propagation with preserved iteration context
          this.queue.enqueue({ nodeId: edge.target, input: result, meta });
        }
      }
    } catch (error) {
      console.error(`❌ Node ${nodeId} failed:`, error);
      this.store.setNodeError(nodeId, error);
    } finally {
      // Complete refcount for loop iteration
      this.queue.dec(meta?.originLoopId, meta?.iterIndex);
    }
  }

  private async executeNode(node: WorkflowNode, input: any): Promise<any> {
    console.log(`🔧 Executing node ${node.id} (${node.type})`);

    // Map node categories for compatibility
    let category = node.category;
    if (node.type === 'If' || node.type === 'Switch' || node.type === 'Edit Fields' || node.type === 'Math' || node.type === 'Transform') {
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

    // Create execution context
    const context: ExecutionContext = {
      nodeId: node.id,
      runId: this.runId,
      workflowId: this.workflowId,
      userId: this.userId,
      getState: (key: string) => this.store.getNodeState(node.id, key),
      setState: (key: string, value: any) => this.store.setNodeState(node.id, key, value),
      getPersistentValue: (key: string) => this.store.getPersistentValue(this.workflowId, key),
      setPersistentValue: (key: string, value: any) => this.store.setPersistentValue(this.workflowId, key, value)
    };

    // Execute node
    const result = await executor.execute(node, input, context);
    
    if (result && typeof result === 'object' && 'success' in result) {
      if (!result.success) {
        throw new Error(result.error || `Node execution failed: ${category}`);
      }
      return result.data;
    }

    return result;
  }
}

/**
 * Factory function to execute a workflow
 */
export async function executeWorkflow(runId: string, workflowId: string, userId: string, nodes: any[], edges: any[]): Promise<{ success: boolean; result?: any; error?: string }> {
  const workflowEngine = new WorkflowEngine(runId, workflowId, userId, nodes, edges);
  return await workflowEngine.execute();
}