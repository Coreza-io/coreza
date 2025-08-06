import { supabase } from '../config/supabase';
import axios from 'axios';
import { IndicatorService } from './indicators';
import { CommunicationService } from './communications';
import { DataService } from './data';
import { HttpService } from './http';
import { WebhookService } from './webhooks';
import { ComparatorService } from './comparator';
import { getNodeExecutor } from '../nodes/registry';
import { NodeInput, NodeResult } from '../nodes/types';
import { resolveReferences } from "../utils/resolveReferences";
import { handleN8NLoopExecution } from '../utils/handleN8NLoopExecution';

export interface WorkflowNode {
  id: string;
  type: string;
  category: string;
  data: any;
  values?: any;
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

interface NodeExecution {
  nodeId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: any;
  output?: any;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

export class WorkflowEngine {
  private runId: string;
  private workflowId: string;
  private nodes: WorkflowNode[];
  private edges: WorkflowEdge[];
  private executions: Map<string, NodeExecution> = new Map();
  private nodeResults: Map<string, any> = new Map();
  private conditionalMap = new Map<string, Record<string, string>>();
  private executedNodes = new Set<string>();
  private userId: string;
  private persistentState: Map<string, any> = new Map();
  private loopContexts: Map<string, any> = new Map();

  constructor(runId: string, workflowId: string, userId: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) {
    this.runId = runId;
    this.workflowId = workflowId;
    this.userId = userId;
    this.nodes = nodes;
    this.edges = edges;
    this.preCalculateConditionalBranches();
  }

  /**
   * Pre-calculate conditional branches for optimization (only for actual branching nodes)
   */
  private preCalculateConditionalBranches(): void {
    this.conditionalMap.clear();
    this.edges.forEach(edge => {
      // Only build branch map for actual branching nodes (If, Switch, etc.)
      const sourceNode = this.nodes.find(n => n.id === edge.source);
      const isBranchingNode = ['if', 'switch'].includes(sourceNode?.type?.toLowerCase() || '');
      
      if (edge.sourceHandle && isBranchingNode) {
        // get—or initialize—the per-node entry
        const entry: Record<string, string[]> =
          this.conditionalMap.get(edge.source)
          ?? {};
        // accumulate multiple targets per handle
        (entry[edge.sourceHandle] ??= []).push(edge.target);

        this.conditionalMap.set(edge.source, entry);
      }
    });
    
    console.log(
        `🗺️ [WORKFLOW EXECUTOR] Built conditional map for ${
          this.conditionalMap.size
        } branching nodes:`,
        Array.from(this.conditionalMap.entries())
      );
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
      
      const outgoing = this.edges.filter(e => e.source === nodeId);
      for (const edge of outgoing) {
        if (hasCycle(edge.target)) return true;
      }
      
      inCurrentPath.delete(nodeId);
      return false;
    };

    for (const node of this.nodes) {
      if (!visitedInCycle.has(node.id) && hasCycle(node.id)) {
        console.error(`🔄 Cycle detected starting from node: ${node.id}`);
        return true;
      }
    }
    return false;
  }

  async execute(): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      // Check for cycles first
      //if (this.detectCycles()) {
      //  throw new Error('Circular dependency detected in workflow');
      //}

      // Load persistent state at the start of execution
      await this.loadPersistentState();

      console.log(`🚀 [WORKFLOW] Starting queue-based workflow execution for run ${this.runId}`);
      
      // Execute nodes using queue-based approach
      await this.executeAllNodes();

      // Mark workflow as completed
      await this.markRunAsCompleted();
      
      // Get final results
      const finalResults = Array.from(this.nodeResults.entries()).reduce((acc, [nodeId, result]) => {
        acc[nodeId] = result;
        return acc;
      }, {} as Record<string, any>);

      console.log(`✅ Workflow execution completed successfully`);
      return { success: true, result: finalResults };
    } catch (error) {
      console.error('❌ Workflow execution failed:', error);
      await this.markRunAsFailed(error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute all nodes using queue-based approach with conditional routing
   */
  private async executeAllNodes(): Promise<void> {
    const queue: string[] = [];
    const MAX_RETRIES = 100;
    let retryCount = 0;

    // Find nodes with no incoming edges (starting points)
    const startingNodes = this.nodes
      .filter(node => !this.edges.some(edge => edge.target === node.id))
      .map(node => node.id);

    if (startingNodes.length === 0) {
      throw new Error('No starting nodes found (nodes without incoming edges)');
    }

    queue.push(...startingNodes);
    console.log(`🎯 Found ${startingNodes.length} starting nodes:`, startingNodes);

    while (queue.length > 0 && retryCount < MAX_RETRIES) {
      const nodeId = queue.shift()!;
      
      // Skip if already executed
      if (this.executedNodes.has(nodeId)) {
        continue;
      }

      const node = this.nodes.find(n => n.id === nodeId);
      if (!node) {
        console.warn(`⚠️ Node ${nodeId} not found, skipping`);
        continue;
      }

      // Check if all dependencies are satisfied
      const upstreamNodes = this.getUpstreamNodes(nodeId);
      const allDependenciesSatisfied = upstreamNodes.every(id => this.executedNodes.has(id));

      if (nodeId !== 'Loop' && !allDependenciesSatisfied) {
        // Re-queue the node for later execution
        queue.push(nodeId);
        retryCount++;
        console.log(`⏳ [WORKFLOW] Dependencies not satisfied for ${nodeId} (${node.type}), re-queuing (retry ${retryCount}) - Run: ${this.runId}`);
        continue;
      }

      try {
        console.log(`🔄 [WORKFLOW] Executing node: ${nodeId} (${node.type}) - Run: ${this.runId}`);
        // Handle loop or branching logic
        
        await this.executeNode(node);
        this.executedNodes.add(nodeId);
        console.log(`✅ [WORKFLOW] Node ${nodeId} (${node.type}) completed successfully - Run: ${this.runId}`);     
        const isBranchingNode = this.conditionalMap.has(nodeId);
        if (isBranchingNode) {
          console.log(`🔀 [WORKFLOW] Processing conditional routing for branch node: ${nodeId} - Run: ${this.runId}`);
          await this.handleBranchNodeResult(nodeId, this.nodeResults.get(nodeId));
        } else {
          // Add downstream nodes to queue for non-branching nodes
          this.addDownstreamNodesToQueue(nodeId, queue);
        }
          
        retryCount = 0; // Reset retry count on successful execution
      } catch (error) {
        console.error(`❌ [WORKFLOW] Failed to execute node ${nodeId} (${node.type}) - Run: ${this.runId}:`, error);
        throw error;
      }
    }

    if (retryCount >= MAX_RETRIES) {
      throw new Error(`Maximum retry count exceeded. Possible circular dependency or missing nodes.`);
    }

    console.log(`✅ All nodes executed successfully. Total executed: ${this.executedNodes.size}`);
  }

  /**
   * Handle branching node result and route to appropriate downstream nodes
   */
  private async handleBranchNodeResult(nodeId: string, result: any): Promise<void> {
    // 1) Normalize result into a string key
    let handleKey: string;
    if (typeof result === 'boolean') {
      handleKey = result.toString();             // "true" or "false"
    } else if (
      result &&
      typeof result === 'object' &&
      ('true' in result || 'false' in result)
    ) {
      handleKey =
        result.true === true
          ? 'true'
          : result.false === true
            ? 'false'
            : '';
    } else {
      handleKey = String(result);
    }

    // 2) Look up the branch map (we expect arrays now)
    const branchMap = this.conditionalMap.get(nodeId) ?? {};
    const raw = branchMap[handleKey];

    // Normalize to string[]
    const targets: string[] = Array.isArray(raw)
      ? raw
      : raw
        ? [raw]
        : [];

    if (targets.length === 0) {
      console.warn(
        `⚠️ No branch found for node ${nodeId} handle "${handleKey}". Available handles:`,
        Object.keys(branchMap)
      );
      return;
    }

    // 3) Execute each branch in turn
    console.log(
      `🔀 Branch node ${nodeId} → handle "${handleKey}" → [${targets.join(', ')}]`
    );
    for (const targetId of targets) {
      await this.executeConditionalChain(targetId);
    }
  }


  /**
   * Execute conditional chain starting from a specific node
   */
  private async executeConditionalChain(startNodeId: string): Promise<void> {
    const queue: string[] = [startNodeId];
    const MAX_RETRIES = 50;
    let retryCount = 0;

    while (queue.length > 0 && retryCount < MAX_RETRIES) {
      const nodeId = queue.shift()!;
      
      // Skip if already executed
      if (this.executedNodes.has(nodeId)) {
        continue;
      }

      const node = this.nodes.find(n => n.id === nodeId);
      if (!node) {
        console.warn(`⚠️ Node ${nodeId} not found in conditional chain, skipping`);
        continue;
      }

      // Check if all dependencies are satisfied
      const upstreamNodes = this.getUpstreamNodes(nodeId);
      const allDependenciesSatisfied = upstreamNodes.every(id => this.executedNodes.has(id));

      if (!allDependenciesSatisfied) {
        // Re-queue the node for later execution
        queue.push(nodeId);
        retryCount++;
        continue;
      }

      try {
        console.log(`🎯 Executing conditional node: ${nodeId} (${node.type})`);
        await this.executeNode(node);
        this.executedNodes.add(nodeId);
        
        // Handle further branching or add downstream nodes
        const isBranchingNode = this.conditionalMap.has(nodeId);
        if (isBranchingNode) {
          await this.handleBranchNodeResult(nodeId, this.nodeResults.get(nodeId));
        } else {
          this.addDownstreamNodesToQueue(nodeId, queue);
        }
        
        retryCount = 0;
      } catch (error) {
        console.error(`❌ Failed to execute conditional node ${nodeId}:`, error);
        throw error;
      }
    }
  }

  /**
   * Collect all node IDs in the subgraph rooted at 'start'
   */
  private collectSubgraphNodeIds(start: string): Set<string> {
    const visited = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      this.edges.filter(e => e.source === cur).forEach(e => stack.push(e.target));
    }
    return visited;
  }

  /**
   * Execute node specifically for loop iteration (bypasses normal dependency checking)
   */
  private async executeNodeForLoop(nodeId: string, executed: Set<string>): Promise<any> {
    const node = this.nodes.find(n => n.id === nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found for loop execution`);
    }

    console.log(`🔄 [LOOP] Executing node: ${nodeId} (${node.type})`);
    
    // Execute the node directly
    await this.executeNode(node);
    
    return this.nodeResults.get(nodeId);
  }

  /**
   * Get node result (for loop context access)
   */
  public getNodeResult(nodeId: string): any {
    return this.nodeResults.get(nodeId);
  }

  /**
   * Set loop context for a node
   */
  public setLoopContext(nodeId: string, context: any): void {
    this.loopContexts.set(nodeId, context);
  }

  /**
   * Clear loop context for a node
   */
  public clearLoopContext(nodeId: string): void {
    this.loopContexts.delete(nodeId);
  }

  /**
   * Get loop context for a node
   */
  public getLoopContext(nodeId: string): any {
    return this.loopContexts.get(nodeId);
  }

  /**
   * Add downstream nodes to the execution queue
   */
  private addDownstreamNodesToQueue(nodeId: string, queue: string[]): void {
    const downstreamNodes = this.edges
      .filter(edge => edge.source === nodeId)
      .map(edge => edge.target)
      .filter(targetId => !this.executedNodes.has(targetId));

    queue.push(...downstreamNodes);
    console.log(`📤 Added ${downstreamNodes.length} downstream nodes to queue:`, downstreamNodes);
  }

  private async executeNode(node: WorkflowNode): Promise<void> {
    const execution: NodeExecution = {
      nodeId: node.id,
      status: 'running',
      input: this.getNodeInput(node),
      startedAt: new Date()
    };

    this.executions.set(node.id, execution);

    // Log node execution start
    await this.logNodeExecution(node.id, 'running', execution.input);

    try {
      // Get node input from upstream nodes
      let nodeInput = this.getNodeInput(node);
      let result: string[] = [];
      if (node.type === 'Loop') {
          console.log(`🔄 [WORKFLOW] Detected Loop node: ${node.id}, delegating to N8N-style execution`);
          const outgoing = this.edges.filter(e => e.source === node.id);
          const fieldState = node.values || {};
          
          // Use centralized N8N-style loop execution
          await handleN8NLoopExecution(
            this,
            { nodes: this.nodes, edges: this.edges },
            node.id,
            fieldState,
            outgoing,
            this.executedNodes,
            this.executeNodeForLoop.bind(this)
          );
          // Mark all nodes in loop subgraph as executed
          const subgraphNodes = this.collectSubgraphNodeIds(node.id);
          subgraphNodes.forEach(id => this.executedNodes.add(id));
      } else {
        // Execute using registry-based approach
        result = await this.executeNodeWithRegistry(node, nodeInput);

      }
      // Store result and mark as completed
      this.nodeResults.set(node.id, result);
      execution.status = 'completed';
      execution.output = result;
      execution.completedAt = new Date();

      await this.logNodeExecution(node.id, 'completed', execution.input, result);
      
    } catch (error) {
      execution.status = 'failed';
      execution.error = error.message;
      execution.completedAt = new Date();
      
      await this.logNodeExecution(node.id, 'failed', execution.input, null, error.message);
      throw error;
    }
  }

  private getNodeInput(node: WorkflowNode): any {
    // Check if there's loop context for this node
    const loopContext = this.loopContexts.get(node.id);
    if (loopContext) {
      console.log(`🔄 [WORKFLOW] Using loop context for node ${node.id}:`, loopContext);
      return { ...node.data, ...loopContext };
    }

    // Get input from upstream nodes
    const upstreamNodes = this.getUpstreamNodes(node.id);
    const input: any = { ...node.data };

    // Merge results from upstream nodes
    for (const upstreamNodeId of upstreamNodes) {
      const upstreamResult = this.nodeResults.get(upstreamNodeId);
      if (upstreamResult) {
        // Merge upstream data
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

  /**
   * Execute node using registry-based approach
   */
  private async executeNodeWithRegistry(node: WorkflowNode, input: NodeInput): Promise<any> {
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

    // Provide context with utility methods
    const context = {
      userId: this.userId,
      workflowId: this.workflowId,
      runId: this.runId,
      persistentState: this.persistentState,
      resolveNodeParameters: (node: WorkflowNode, input: NodeInput) => this.resolveNodeParameters(node, input),
      getPersistentValue: (key: string) => this.getPersistentValue(key),
      setPersistentValue: (key: string, value: any) => this.setPersistentValue(key, value)
    };

    const result = await executor.execute(node, input, context);
    
    if (!result.success) {
      throw new Error(result.error || `Node execution failed: ${category}`);
    }

    return result.data;
  }


  private async executeInputNode(node: WorkflowNode, input: any): Promise<any> {
    // Input nodes just pass through their data
    return { ...node.data, timestamp: new Date().toISOString() };
  }

  private async executeIndicatorNode(node: WorkflowNode, input: any): Promise<any> {
    const indicatorType = node.type.toLowerCase();
    
    // Use the existing resolveNodeParameters method
    const resolvedParams = this.resolveNodeParameters(node, input);
    
    // Apply field mapping for frontend -> backend compatibility
    const mappedParams = this.mapIndicatorFields(indicatorType, resolvedParams);
    
    // Merge node configuration with input data
    // Node parameters take precedence over input data
    const combinedInput = {
      ...input,
      ...mappedParams
    };
    
    return await IndicatorService.calculate(indicatorType, combinedInput);
  }

  private mapIndicatorFields(indicatorType: string, params: any): any {
    const mappedParams = { ...params };
    
    switch (indicatorType) {
      case 'ema':
      case 'rsi':
        // Map 'window' to 'period' for EMA and RSI
        if (mappedParams.window !== undefined) {
          mappedParams.period = mappedParams.window;
          delete mappedParams.window;
        }
        break;
        
      case 'macd':
        // Map MACD field names
        if (mappedParams.fast_length !== undefined) {
          mappedParams.fastPeriod = mappedParams.fast_length;
          delete mappedParams.fast_length;
        }
        if (mappedParams.slow_length !== undefined) {
          mappedParams.slowPeriod = mappedParams.slow_length;
          delete mappedParams.slow_length;
        }
        if (mappedParams.signal_length !== undefined) {
          mappedParams.signalPeriod = mappedParams.signal_length;
          delete mappedParams.signal_length;
        }
        break;
        
      case 'bb':
        // Map Bollinger Bands field names
        if (mappedParams.std_dev_multiplier !== undefined) {
          mappedParams.stdDev = mappedParams.std_dev_multiplier;
          delete mappedParams.std_dev_multiplier;
        }
        break;
        
      // ADX and Stochastic already use correct field names
      default:
        break;
    }
    
    return mappedParams;
  }
  // 1) Define a deep‑resolve helper inside your method (so it closes over `this`, `input`, `allNodeData`)
  private resolveDeep(
    val: any,
    input: any,
    allNodeData: Record<string, any>
  ): any {
    if (typeof val === 'string' && val.includes('{')) {
      const resolved = resolveReferences(val, input, allNodeData, this.nodes);
      // If resolveReferences returned non-string, return it directly
      return resolved;
      //return this.resolveReferences(val, input, allNodeData);
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

  private async logNodeExecution(
    nodeId: string, 
    status: string, 
    input: any, 
    output?: any, 
    errorMessage?: string
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
          error_message: errorMessage
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

  /**
   * Load persistent state from workflow
   */
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
        // Convert JSON object to Map
        Object.entries(workflow.persistent_state).forEach(([key, value]) => {
          this.persistentState.set(key, value);
        });
        console.log(`📥 Loaded ${this.persistentState.size} persistent values for workflow ${this.workflowId}`);
      }
    } catch (error) {
      console.warn(`⚠️ Error loading persistent state:`, error);
    }
  }

  /**
   * Save persistent state to workflow
   */
  private async savePersistentState(): Promise<void> {
    try {
      // Convert Map to plain object
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

  /**
   * Get a persistent value
   */
  public getPersistentValue(key: string): any {
    return this.persistentState.get(key);
  }

  /**
   * Set a persistent value and save to database
   */
  public async setPersistentValue(key: string, value: any): Promise<void> {
    this.persistentState.set(key, value);
    await this.savePersistentState();
  }
}

/**
 * Factory function to execute a workflow
 */
export async function executeWorkflow(runId: string, workflowId: string, userId: string, nodes: any[], edges: any[]): Promise<{ success: boolean; result?: any; error?: string }> {
  const workflowEngine = new WorkflowEngine(runId, workflowId, userId, nodes, edges);
  return await workflowEngine.execute();
}