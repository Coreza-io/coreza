import { supabase } from '../config/supabase';
import { QueueManager } from './queueManagerV2';
import { NodeRouter } from './router';
import { LoopHandler } from './loopHandler';
import { NodeStoreV2 } from './nodeStoreV2';
import { getNodeExecutor } from '../nodes/registry';
import { resolveReferences } from "../utils/resolveReferences";
import { WorkflowNode, WorkflowEdge, QueueItem, IterMeta } from '../nodes/types';

interface ExecCtx {
  userId: string;
  workflowId: string;
  runId: string;
  nodeId: string;
}

/**
 * New single-queue workflow engine that replicates frontend semantics
 */
export class WorkflowEngineV2 {
  private router: NodeRouter;
  private queue: QueueManager;
  private loop: LoopHandler;
  private store: NodeStoreV2;
  private executions = new Map<string, any>();
  private nodeResults = new Map<string, any>();
  private persistentState = new Map<string, any>();

  constructor(
    private runId: string,
    private workflowId: string,
    private userId: string,
    private nodes: WorkflowNode[],
    private edges: WorkflowEdge[],
    private impls: Record<string, (input: any, ctx: ExecCtx) => Promise<any>> = {}
  ) {
    this.router = new NodeRouter(edges);
    this.queue = new QueueManager();
    this.store = new NodeStoreV2(runId);
    this.loop = new LoopHandler(this.store, this.router, this.queue);

    // Initialize node definitions in store
    this.nodes.forEach(node => {
      this.store.setNodeDef(node.id, node);
    });

    // Set up default node implementations
    this.setupDefaultImplementations();
  }

  private setupDefaultImplementations() {
    // Default implementation that uses the registry
    this.impls['__default__'] = async (input: any, ctx: ExecCtx) => {
      const node = this.nodes.find(n => n.id === ctx.nodeId)!;
      return await this.executeNodeWithRegistry(node, input);
    };

    // Specific implementations for different node types
    this.impls['If'] = async (input: any, ctx: ExecCtx) => {
      const node = this.nodes.find(n => n.id === ctx.nodeId)!;
      return await this.executeNodeWithRegistry(node, input);
    };

    this.impls['Switch'] = async (input: any, ctx: ExecCtx) => {
      const node = this.nodes.find(n => n.id === ctx.nodeId)!;
      return await this.executeNodeWithRegistry(node, input);
    };
  }

  async run(entryNodes?: string[], initialInput?: any) {
    try {
      console.log(`🚀 [WORKFLOW V2] Starting single-queue workflow execution for run ${this.runId}`);
      
      // Load persistent state
      await this.loadPersistentState();

      // Find entry nodes if not provided
      if (!entryNodes) {
        entryNodes = this.nodes
          .filter(node => !this.edges.some(edge => edge.target === node.id))
          .map(node => node.id);
      }

      if (entryNodes.length === 0) {
        throw new Error('No starting nodes found (nodes without incoming edges)');
      }

      // Seed queue with entry nodes
      for (const id of entryNodes) {
        this.queue.enqueue({ nodeId: id, input: initialInput });
      }

      console.log(`🎯 Found ${entryNodes.length} starting nodes:`, entryNodes);

      // Main execution loop - pump the queue
      for (let item = this.queue.dequeue(); item; item = this.queue.dequeue()) {
        await this.executeOnce(item);
      }

      await this.markRunAsCompleted();
      
      // Get final results
      const finalResults = Array.from(this.nodeResults.entries()).reduce((acc, [nodeId, result]) => {
        acc[nodeId] = result;
        return acc;
      }, {} as Record<string, any>);

      console.log(`✅ Workflow V2 execution completed successfully`);
      return { success: true, result: finalResults };

    } catch (error) {
      console.error('❌ Workflow V2 execution failed:', error);
      const message = (error as Error).message;
      await this.markRunAsFailed(message);
      return { success: false, error: message };
    }
  }

  private async executeOnce(item: QueueItem) {
    const { nodeId, input, meta } = item;
    const def = this.store.getNodeDef(nodeId);

    if (!def) {
      console.warn(`⚠️ Node ${nodeId} not found, skipping`);
      return;
    }

    // Track this task for the loop refcount if inside a loop body
    this.queue.inc(meta?.originLoopId, meta?.iterIndex);

    const execution = {
      nodeId,
      status: 'running' as const,
      input,
      startedAt: new Date(),
      attempt: 1,
    };

    this.executions.set(nodeId, execution);
    await this.store.setNodeState(nodeId, 'running');
    await this.logNodeExecution(nodeId, 'running', input, undefined, undefined, 1);

    try {
      console.log(`🔄 [WORKFLOW V2] Executing node: ${nodeId} (${def.type}) - Run: ${this.runId}`);

      if (def.type === 'Loop') {
        // One tick only - LoopHandler manages re-queuing
        await this.loop.tick(nodeId, input);
        return; // children enqueued by LoopHandler
      }

      // Get the resolved input for this node
      const resolvedInput = this.getNodeInput(def, input);

      // Run user node (or system node)
      const fn = this.impls[def.type] ?? this.impls['__default__'];
      const result = await fn(resolvedInput, { 
        nodeId, 
        userId: this.userId, 
        workflowId: this.workflowId, 
        runId: this.runId 
      });

      // Store result
      this.setNodeResult(nodeId, result);

      execution.status = 'completed';
      execution.output = result;
      execution.completedAt = new Date();

      await this.store.setNodeOutput(nodeId, result);
      await this.store.setNodeState(nodeId, 'completed');
      await this.logNodeExecution(nodeId, 'completed', input, result, undefined, 1);

      // Branch routing - select edges based on result
      const edgesToFire = this.router.select(nodeId, result);
      
      for (const e of edgesToFire) {
        // Feedback into Loop: if target is a Loop, buffer, don't execute now
        const targetDef = this.store.getNodeDef(e.target);
        if (targetDef?.type === 'Loop') {
          this.store.bufferToLoop(e.target, e.id, result);
          // do not enqueue the Loop here; LoopHandler will re-tick on drain
        } else {
          // normal propagation; preserve iteration scope if any
          this.queue.enqueue({ nodeId: e.target, input: result, meta });
        }
      }

    } catch (error) {
      execution.status = 'failed';
      execution.error = (error as Error).message;
      execution.completedAt = new Date();

      await this.store.setNodeState(nodeId, 'failed');
      await this.logNodeExecution(nodeId, 'failed', input, null, (error as Error).message, 1);
      
      // TODO: respect continueOnError per node; for now, just stop this branch
      this.store.setNodeError(nodeId, error);
      throw error;
    } finally {
      // complete this task within its iteration scope
      this.queue.dec(meta?.originLoopId, meta?.iterIndex);
    }
  }

  private getNodeInput(node: WorkflowNode, queueInput?: any): any {
    // For Loop nodes, check if there's edge buffer data
    if (node.type === 'Loop') {
      const state = this.store.getLoopState(node.id);
      if (state) {
        // Loop is running, use loop items
        return state.loopItems;
      }
      // New loop, use queue input or node data
      return queueInput ?? node.data ?? {};
    }

    // For other nodes, use queue input or resolve from upstream
    if (queueInput !== undefined) {
      return { ...node.data, ...queueInput };
    }

    // Fallback: get from upstream nodes
    const upstreamNodes = this.getUpstreamNodes(node.id);
    const input: any = { ...node.data };

    for (const upstreamNodeId of upstreamNodes) {
      const upstreamResult = this.nodeResults.get(upstreamNodeId);
      if (upstreamResult) {
        Object.assign(input, upstreamResult);
      }
    }

    return input;
  }

  private getUpstreamNodes(nodeId: string): string[] {
    return this.edges
      .filter(edge => edge.target === nodeId)
      .map(edge => edge.source);
  }

  private async executeNodeWithRegistry(node: WorkflowNode, input: any): Promise<any> {
    // Map node categories to ensure compatibility
    let category = node.category;
    
    // Handle special category mappings for existing nodes
    if (node.type === 'If' || node.type === 'Switch' || node.type === 'Edit Fields' || node.type === 'Math' || node.type === 'Transform' || node.type === 'Loop') {
      category = 'ControlFlow';
    } else if (['Scheduler', 'trigger', 'Visualize', 'webhook', 'httprequest'].includes(node.type)) {
      category = 'Utility';
    } else if (['Gmail', 'WhatsApp'].includes(node.type)) {
      category = 'Communication';
    } else if (['FinnHub', 'YahooFinance'].includes(node.type)) {
      category = 'DataSource';
    }

    const executor = getNodeExecutor(category);
    
    if (!executor) {
      throw new Error(`Unsupported node category: ${category} for node type: ${node.type}`);
    }

    console.log(`🔧 Executing node ${node.id} (${node.type}) with category ${category} using ${executor.constructor.name}`);

    // Resolve node parameters with reference resolution
    const resolvedParams = this.resolveNodeParameters(node, input);
    const combinedInput = { ...input, ...resolvedParams };

    // Provide context with utility methods
    const context = {
      userId: this.userId,
      workflowId: this.workflowId,
      runId: this.runId,
      persistentState: this.persistentState,
      resolveNodeParameters: (node: WorkflowNode, input: any) => this.resolveNodeParameters(node, input),
      getPersistentValue: (key: string) => this.getPersistentValue(key),
      setPersistentValue: (key: string, value: any) => this.setPersistentValue(key, value)
    };

    const result = await executor.execute(node, combinedInput, context);
    
    if (!result.success) {
      throw new Error(result.error || `Node execution failed: ${category}`);
    }

    return result.data;
  }

  private resolveNodeParameters(node: WorkflowNode, input: any): any {
    const nodeParams = node.values || {};
    const resolvedParams: any = {};
    
    // Get all node data for cross-references
    const allNodeData: Record<string, any> = {};
    for (const [nodeId, result] of this.nodeResults.entries()) {
      allNodeData[nodeId] = result;
    }
    
    // Resolve all node.values parameters with reference resolution
    for (const [key, value] of Object.entries(nodeParams)) {
      // Skip operational fields that are handled separately
      if (key === 'credential_id' || key === 'operation') continue;
      // Deeply resolve strings/arrays/objects
      resolvedParams[key] = this.resolveDeep(value, input, allNodeData);
    }
    
    return resolvedParams;
  }

  private resolveDeep(val: any, input: any, allNodeData: Record<string, any>): any {
    if (typeof val === 'string' && val.includes('{')) {
      const resolved = resolveReferences(val, input, allNodeData, this.nodes);
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

  public setNodeResult(nodeId: string, result: any): void {
    this.nodeResults.set(nodeId, result);
  }

  public getNodeResult(nodeId: string): any {
    return this.nodeResults.get(nodeId);
  }

  public getPersistentValue(key: string): any {
    return this.persistentState.get(key);
  }

  public async setPersistentValue(key: string, value: any): Promise<void> {
    this.persistentState.set(key, value);
    await this.savePersistentState();
  }

  private async loadPersistentState(): Promise<void> {
    try {
      const { data: workflow, error } = await supabase
        .from('workflows')
        .select('persistent_state')
        .eq('id', this.workflowId)
        .single();

      if (error) {
        console.warn(`⚠️ Failed to load persistent state for workflow ${this.workflowId}:`, error);
        return;
      }

      if (workflow?.persistent_state) {
        Object.entries(workflow.persistent_state).forEach(([key, value]) => {
          this.persistentState.set(key, value);
        });
        console.log(`📥 Loaded ${this.persistentState.size} persistent values for workflow ${this.workflowId}`);
      }
    } catch (error) {
      console.warn(`⚠️ Error loading persistent state:`, error);
    }
  }

  private async savePersistentState(): Promise<void> {
    try {
      const stateObject = Object.fromEntries(this.persistentState);

      const { error } = await supabase
        .from('workflows')
        .update({
          persistent_state: stateObject,
          updated_at: new Date().toISOString()
        })
        .eq('id', this.workflowId);

      if (error) {
        console.error(`❌ Failed to save persistent state for workflow ${this.workflowId}:`, error);
      } else {
        console.log(`💾 Saved ${this.persistentState.size} persistent values for workflow ${this.workflowId}`);
      }
    } catch (error) {
      console.error(`❌ Error saving persistent state:`, error);
    }
  }

  private async logNodeExecution(
    nodeId: string,
    status: string,
    input: any,
    output?: any,
    errorMessage?: string,
    attempt?: number
  ): Promise<void> {
    try {
      await supabase
        .from('node_executions')
        .insert({
          run_id: this.runId,
          node_id: nodeId,
          status,
          input_payload: input,
          output_payload: output,
          error_message: errorMessage,
          attempt
        });
    } catch (error) {
      console.error('Failed to log node execution:', error);
    }
  }

  private async markRunAsCompleted(): Promise<void> {
    await supabase
      .from('workflow_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: Array.from(this.nodeResults.entries()).reduce((acc, [nodeId, result]) => {
          acc[nodeId] = result;
          return acc;
        }, {} as Record<string, any>)
      })
      .eq('id', this.runId);
  }

  private async markRunAsFailed(error: string): Promise<void> {
    await supabase
      .from('workflow_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error
      })
      .eq('id', this.runId);
  }
}

/**
 * Factory function to execute a workflow using V2 engine
 */
export async function executeWorkflowV2(runId: string, workflowId: string, userId: string, nodes: any[], edges: any[]): Promise<{ success: boolean; result?: any; error?: string }> {
  const workflowEngine = new WorkflowEngineV2(runId, workflowId, userId, nodes, edges);
  return await workflowEngine.run();
}