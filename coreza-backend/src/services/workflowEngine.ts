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

  constructor(
    private runId: string,
    private workflowId: string,
    private userId: string,
    private nodes: WorkflowNode[],
    private edges: WorkflowEdge[]
  ) {
    this.router = new NodeRouter(edges);
    // Add node type lookup to router
    (this.router as any).getSourceNodeType = (nodeId: string) => {
      const node = this.nodes.find(n => n.id === nodeId);
      return node?.type;
    };
    this.queue = new QueueManager();
    this.store = new NodeStoreV2(runId, nodes);
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

    try {
      // Execute the node
      const fullResult = await this.executeNode(node, input);
       // Extract data for downstream routing
      const result = fullResult?.data || fullResult;
      console.log(`✅ Node ${nodeId} result:`, result);

      // Store full result (with metadata)
      this.store.setNodeResult(nodeId, result);

      // Handle Loop node routing based on result metadata
      if (node.type === 'Loop' && fullResult && typeof fullResult === 'object') {
        if (fullResult.meta?.isLoopCompleted) {
          // Loop is completed, route to 'done' edges
          console.log(`🏁 [LOOP] Node ${nodeId} completed, routing to 'done' edges`);
          const doneEdges = this.router.doneEdges(nodeId);
          for (const edge of doneEdges) {
            console.log(`➡️ [QUEUE] Enqueuing ${edge.target} with final result`);
            this.queue.enqueue({ nodeId: edge.target, input: result, meta });
          }
        } else if (fullResult.meta?.isLoopIteration) {
          // Loop iteration, route to 'loop' edges (body execution)
          console.log(`🔄 [LOOP] Node ${nodeId} iteration, routing to 'loop' edges`);
          const loopEdges = this.router.loopBodyEdges(nodeId);
          for (const edge of loopEdges) {
            console.log(`➡️ [QUEUE] Enqueuing ${edge.target} with loop item`);
            this.queue.enqueue({ 
              nodeId: edge.target, 
              input: result, 
              meta: { 
                ...meta, 
                originLoopId: nodeId,
                iterIndex: fullResult.meta.currentIndex
              }
            });
          }
        }
        return; // Exit early for Loop nodes
      }

      // Handle feedback to Loop nodes (from downstream nodes back to loop)
    if (meta?.originLoopId) {
        const loopNodeId = meta.originLoopId;
        const loopNode = this.nodes.find(n => n.id === loopNodeId);
        
        // Check if this node actually has an edge back to the loop
        const hasEdgeBackToLoop = this.edges.some(edge => 
          edge.source === nodeId && edge.target === loopNodeId
        );
        
        if (loopNode?.type === 'Loop' && hasEdgeBackToLoop) {
          console.log(`🔄 [LOOP] Node ${nodeId} feeding back to loop ${loopNodeId}`);
          
          // Aggregate result to loop with node context
          const currentResults = this.store.getNodeState(loopNodeId, 'aggregatedResults') || [];
          currentResults.push(result);
          this.store.setNodeState(loopNodeId, 'aggregatedResults', currentResults);
        }
      }

      // Regular node routing
      const edges = this.router.select(nodeId, result);
      console.log(`🎯 Routing from ${nodeId} via ${edges.length} edges`);

      for (const edge of edges) {
        console.log(`➡️ [QUEUE] Enqueuing ${edge.target} with input:`, result);
        this.queue.enqueue({ nodeId: edge.target, input: result, meta });
      }
      
    } catch (error) {
      console.error(`❌ Node ${nodeId} failed:`, error);
      this.store.setNodeError(nodeId, error);
      
      // For loop iterations with continueOnError, aggregate the error instead of crashing
      if (meta?.originLoopId) {
        const loopNode = this.nodes.find(n => n.id === meta.originLoopId);
        const config = loopNode?.values || {};
        if (config.continueOnError) {
          const currentResults = this.store.getNodeState(meta.originLoopId, 'aggregatedResults') || [];
          currentResults.push({ error: error.message });
          this.store.setNodeState(meta.originLoopId, 'aggregatedResults', currentResults);
          
          // Re-queue the loop to continue processing
          this.queue.enqueue({ nodeId: meta.originLoopId, input: {}, meta: {} });
          return; // Don't propagate error in continue-on-error mode
        }
      }
      
      // Normal error handling - stop execution
      throw error;
    }
  }

  private async executeNode(node: WorkflowNode, input: any): Promise<any> {
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

    // Create execution context
    const context: ExecutionContext = {
      nodeId: node.id,
      runId: this.runId,
      workflowId: this.workflowId,
      userId: this.userId,
      getState: (key: string) => this.store.getNodeState(node.id, key),
      setState: (key: string, value: any) => this.store.setNodeState(node.id, key, value),
      getPersistentValue: (key: string) => this.store.getPersistentValue(this.workflowId, key),
      setPersistentValue: (key: string, value: any) => this.store.setPersistentValue(this.workflowId, key, value),
      resolveNodeParameters: (node: WorkflowNode, input: any) => this.resolveNodeParameters(node, input)
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
export async function executeWorkflow(runId: string, workflowId: string, userId: string, nodes: any[], edges: any[]): Promise<{ success: boolean; result?: any; error?: string }> {
  const workflowEngine = new WorkflowEngine(runId, workflowId, userId, nodes, edges);
  return await workflowEngine.execute();
}