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
import { NodeStore } from './nodeStore';
import { NodeScheduler } from './nodeScheduler';

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
  attempt: number;
}

export class WorkflowEngine {
  private runId: string;
  private workflowId: string;
  private nodes: WorkflowNode[];
  private edges: WorkflowEdge[];
  private executions: Map<string, NodeExecution> = new Map();
  private nodeResults: Map<string, any> = new Map();
  private conditionalMap = new Map<string, Record<string, string[]>>();
  private executedNodes = new Set<string>();
  private userId: string;
  private persistentState: Map<string, any> = new Map();
  private loopContexts: Map<string, any> = new Map();
  private scheduler = new NodeScheduler();
  private nodeAttempts: Map<string, number> = new Map();
  private edgeBuffers: Map<string, Record<string, any>> = new Map();
  private maxParallel: number;

  constructor(runId: string, workflowId: string, userId: string, nodes: WorkflowNode[], edges: WorkflowEdge[], maxParallel = parseInt(process.env.WORKFLOW_MAX_PARALLELISM || '4')) {
    this.runId = runId;
    this.workflowId = workflowId;
    this.userId = userId;
    this.nodes = nodes;
    this.edges = edges;
    this.maxParallel = maxParallel;
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
      const message = (error as Error).message;
      await this.markRunAsFailed(message);
      return { success: false, error: message };
    }
  }

  /**
   * Execute all nodes using queue-based approach with conditional routing
   */
  private async executeAllNodes(): Promise<void> {
    const MAX_RETRIES = 100;
    const retryCount = new Map<string, number>();

    // Find nodes with no incoming edges (starting points)
    const startingNodes = this.nodes
      .filter(node => !this.edges.some(edge => edge.target === node.id))
      .map(node => node.id);

    if (startingNodes.length === 0) {
      throw new Error('No starting nodes found (nodes without incoming edges)');
    }

    for (const id of startingNodes) {
      await this.enqueueNode(id);
    }
    console.log(`🎯 Found ${startingNodes.length} starting nodes:`, startingNodes);

    const worker = async () => {
      while (this.executedNodes.size < this.nodes.length) {
        let nodeId = await this.dequeueNode();
        if (!nodeId) {
          // wait briefly for new nodes
          await new Promise(r => setTimeout(r, 50));
          if (this.scheduler.length === 0 && this.executedNodes.size >= this.nodes.length) break;
          continue;
        }

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
        const childrenDone = await this.areChildrenComplete(nodeId);

        if (nodeId !== 'Loop' && (!allDependenciesSatisfied || !childrenDone)) {
          const retries = (retryCount.get(nodeId) || 0) + 1;
          if (retries >= MAX_RETRIES) {
            throw new Error(`Maximum retry count exceeded for node ${nodeId}`);
          }
          retryCount.set(nodeId, retries);
          await this.enqueueNode(nodeId, Date.now() + 100);
          console.log(`⏳ [WORKFLOW] Dependencies not satisfied for ${nodeId} (${node.type}), re-queuing (retry ${retries}) - Run: ${this.runId}`);
          continue;
        }

        const attempt = (this.nodeAttempts.get(nodeId) || 0) + 1;
        this.nodeAttempts.set(nodeId, attempt);

        try {
          console.log(`🔄 [WORKFLOW] Executing node: ${nodeId} (${node.type}) attempt ${attempt} - Run: ${this.runId}`);

          await this.executeNode(node, attempt);
          this.executedNodes.add(nodeId);
          retryCount.delete(nodeId);

          const isBranchingNode = this.conditionalMap.has(nodeId);
          if (isBranchingNode) {
            console.log(`🔀 [WORKFLOW] Processing conditional routing for branch node: ${nodeId} - Run: ${this.runId}`);
            await this.handleBranchNodeResult(nodeId, this.nodeResults.get(nodeId));
          } else {
            await this.addDownstreamNodesToQueue(nodeId, this.scheduler);
          }
        } catch (error) {
          console.error(`❌ [WORKFLOW] Node ${nodeId} failed on attempt ${attempt}:`, error);
          const maxAttempts = node.values?.maxAttempts ?? 1;
          const continueOnError = node.values?.continueOnError || node.data?.continueOnError;

          if (attempt < maxAttempts) {
            console.log(`🔁 [WORKFLOW] Re-queueing node ${nodeId} for retry ${attempt + 1}/${maxAttempts}`);
            await this.enqueueNode(nodeId, Date.now() + 500);
          } else if (continueOnError) {
            console.warn(`⚠️ [WORKFLOW] Node ${nodeId} failed after ${attempt} attempts but continuing due to policy`);
            this.executedNodes.add(nodeId);
            this.nodeResults.set(nodeId, { success: false, error: (error as Error).message });
          } else {
            throw error;
          }
        }
      }
    };

    // Launch worker pool
    const workers = Array.from({ length: this.maxParallel }, () => worker());
    await Promise.all(workers);

    console.log(`✅ All nodes executed. Total executed: ${this.executedNodes.size}`);
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

    // 3) For each firing edge, aggregate to Loop if target is Loop, pass original input data
    const originalInput = this.getNodeInput(this.nodes.find(n => n.id === nodeId)!);
    for (const targetId of targets) {
      // Find the edge from this branch node to the target
      const edge = this.edges.find(e => e.source === nodeId && e.target === targetId);
      if (edge) {
        // Aggregate to Loop using original input data (not branch evaluation result)
        this.aggregateToLoop(nodeId, edge, originalInput);
      }
      await this.executeConditionalChain(targetId);
    }
  }


  /**
   * Execute conditional chain starting from a specific node
   */
  private async executeConditionalChain(startNodeId: string): Promise<void> {
    const scheduler = new NodeScheduler();
    await scheduler.enqueue(startNodeId);
    const MAX_RETRIES = 50;
    let retryCount = 0;

    while (scheduler.length > 0 && retryCount < MAX_RETRIES) {
      const nodeId = await scheduler.dequeue();
      if (!nodeId) break;

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
      const childrenDone = await this.areChildrenComplete(nodeId);

      if (!allDependenciesSatisfied || !childrenDone) {
        // Re-queue the node for later execution
        await scheduler.enqueue(nodeId, Date.now() + 100);
        retryCount++;
        continue;
      }

      try {
        const attempt = (this.nodeAttempts.get(nodeId) || 0) + 1;
        this.nodeAttempts.set(nodeId, attempt);
        console.log(`🎯 Executing conditional node: ${nodeId} (${node.type}) attempt ${attempt}`);
        await this.executeNode(node, attempt);
        this.executedNodes.add(nodeId);

        // Handle further branching or add downstream nodes
        const isBranchingNode = this.conditionalMap.has(nodeId);
        if (isBranchingNode) {
          await this.handleBranchNodeResult(nodeId, this.nodeResults.get(nodeId));
        } else {
          await this.addDownstreamNodesToQueue(nodeId, scheduler);
        }

        retryCount = 0;
      } catch (error) {
        console.error(`❌ Failed to execute conditional node ${nodeId} attempt ${this.nodeAttempts.get(nodeId)}:`, error);
        const maxAttempts = node.values?.maxAttempts ?? 1;
        const continueOnError = node.values?.continueOnError || node.data?.continueOnError;
        const attempt = this.nodeAttempts.get(nodeId) || 1;

        if (attempt < maxAttempts) {
          await scheduler.enqueue(nodeId, Date.now() + 500);
          retryCount++;
        } else if (continueOnError) {
          this.executedNodes.add(nodeId);
          this.nodeResults.set(nodeId, { success: false, error: (error as Error).message });
        } else {
          throw error;
        }
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

    // Track attempts for loop executions as well
    const attempt = (this.nodeAttempts.get(node.id) || 0) + 1;
    this.nodeAttempts.set(node.id, attempt);

    // Execute the node directly
    await this.executeNode(node, attempt);

    return this.nodeResults.get(nodeId);
  }

  /**
   * Get node result (for loop context access)
   */
  public getNodeResult(nodeId: string): any {
    return this.nodeResults.get(nodeId);
  }

  /**
   * Store result for a node
   */
  public setNodeResult(nodeId: string, result: any): void {
    this.nodeResults.set(nodeId, result);
    void NodeStore.setNodeOutput(this.runId, nodeId, result);
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
   * Add downstream nodes to the execution scheduler
   */
  private async addDownstreamNodesToQueue(nodeId: string, scheduler: NodeScheduler): Promise<void> {
    const downstreamEdges = this.edges.filter(edge => edge.source === nodeId);
    const downstreamNodes = downstreamEdges
      .map(edge => edge.target)
      .filter(targetId => !this.executedNodes.has(targetId));

    // For each downstream edge, check if target is a Loop and aggregate
    for (const edge of downstreamEdges) {
      this.aggregateToLoop(nodeId, edge, this.nodeResults.get(nodeId));
    }

    for (const id of downstreamNodes) {
      await scheduler.enqueue(id);
    }
    console.log(`📤 Added ${downstreamNodes.length} downstream nodes to queue:`, downstreamNodes);
  }

  private async enqueueNode(nodeId: string, throttleUntil?: number): Promise<void> {
    await this.scheduler.enqueue(nodeId, throttleUntil);
  }

  private async dequeueNode(): Promise<string | undefined> {
    return await this.scheduler.dequeue();
  }

  private async areChildrenComplete(nodeId: string): Promise<boolean> {
    const children = this.edges.filter(e => e.source === nodeId).map(e => e.target);
    for (const child of children) {
      const state = await NodeStore.getNodeState(this.runId, child);
      if (state && state !== 'completed') {
        return false;
      }
    }
    return true;
  }

  private async executeNode(node: WorkflowNode, attempt: number): Promise<void> {
    const execution: NodeExecution = {
      nodeId: node.id,
      status: 'running',
      input: this.getNodeInput(node),
      startedAt: new Date(),
      attempt,
    };

    this.executions.set(node.id, execution);
    await NodeStore.setNodeState(this.runId, node.id, 'running');

    // Log node execution start
    await this.logNodeExecution(node.id, 'running', execution.input, undefined, undefined, attempt);

    try {
      // Get node input from upstream nodes
      let nodeInput = this.getNodeInput(node);
      let result: any;
      if (node.type === 'Loop') {
        // Process Loop using edge buffer like frontend
        console.log(`🔄 [WORKFLOW] Processing Loop node: ${node.id} using edge buffer approach`);
        result = this.processLoopNode(node);
      } else {
        // Execute using registry-based approach
        result = await this.executeNodeWithRegistry(node, nodeInput);
      }
      
      // Store result and mark as completed
      this.setNodeResult(node.id, result);

      execution.status = 'completed';
      execution.output = this.getNodeResult(node.id);
      execution.completedAt = new Date();

      await NodeStore.setNodeOutput(this.runId, node.id, execution.output);
      await NodeStore.setNodeState(this.runId, node.id, 'completed');
      await this.logNodeExecution(node.id, 'completed', execution.input, result, undefined, attempt);

    } catch (error) {
      execution.status = 'failed';
      execution.error = (error as Error).message;
      execution.completedAt = new Date();

      await NodeStore.setNodeState(this.runId, node.id, 'failed');
      await this.logNodeExecution(node.id, 'failed', execution.input, null, (error as Error).message, attempt);
      throw error;
    }
  }

  private getNodeInput(node: WorkflowNode): any {
    // For Loop nodes, prioritize edge buffer data
    if (node.type === 'Loop') {
      const edgeBuffer = this.edgeBuffers.get(node.id);
      if (edgeBuffer && Object.keys(edgeBuffer).length > 0) {
        console.log(`🔄 [WORKFLOW] Using edge buffer for Loop ${node.id}:`, edgeBuffer);
        // Aggregate all edge buffer values
        const aggregatedData = Object.values(edgeBuffer).flat();
        return { ...node.data, _edgeBuf: edgeBuffer, aggregatedData };
      }
    }

    // Check if there's loop context for this node
    const loopContext = this.loopContexts.get(node.id);
    if (loopContext) {
      console.log(`🔄 [WORKFLOW] Using loop context for node ${node.id}:`, loopContext);
      // For loop nodes, use ONLY the loop context + node data, don't merge upstream results
      // This ensures downstream nodes get individual items, not the entire array
      return { ...node.data, ...loopContext };
    }

    // Get input from upstream nodes
    const upstreamNodes = this.getUpstreamNodes(node.id);
    const input: any = { ...node.data };

    // Merge results from upstream nodes (only when NOT in loop context)
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

  /**
   * Helper method to aggregate payloads to Loop nodes when an edge fires
   */
  private aggregateToLoop(sourceNodeId: string, edge: WorkflowEdge, result: any): void {
    const targetNode = this.nodes.find(n => n.id === edge.target);
    const isLoop = targetNode?.type === 'Loop';

    if (!isLoop) return;

    const loopId = edge.target;
    
    // Check if this is a feedback edge (source node is downstream of the Loop)
    // vs a trigger edge (source node is upstream/independent of the Loop)
    const isFeedbackEdge = this.isNodeDownstreamOfLoop(sourceNodeId, loopId);
    
    if (!isFeedbackEdge) {
      console.log(`🚫 [LOOP AGGREGATION] Skipping trigger edge ${edge.id} from ${sourceNodeId} to Loop ${loopId} - not a feedback edge`);
      return;
    }

    const existingBuffer = this.edgeBuffers.get(loopId) || {};
    const updatedBuffer = { ...existingBuffer, [edge.id]: result };
    this.edgeBuffers.set(loopId, updatedBuffer);

    console.log(`🔄 [LOOP AGGREGATION] Edge ${edge.id} from ${sourceNodeId} to Loop ${loopId} aggregated feedback result:`, result);
  }

  /**
   * Check if a source node is downstream of a Loop node (i.e., it's part of the loop flow)
   * This helps distinguish between trigger edges and feedback edges
   */
  private isNodeDownstreamOfLoop(sourceNodeId: string, loopNodeId: string): boolean {
    // Get all nodes that are downstream of the Loop node
    const downstreamNodes = this.getDownstreamNodes(loopNodeId, new Set());
    
    // If the source node is in the downstream nodes, it's a feedback edge
    return downstreamNodes.has(sourceNodeId);
  }

  /**
   * Get all nodes downstream of a given node
   */
  private getDownstreamNodes(nodeId: string, visited: Set<string> = new Set()): Set<string> {
    if (visited.has(nodeId)) return new Set();
    
    visited.add(nodeId);
    const downstream = new Set<string>();
    
    // Find all outgoing edges from this node
    const outgoingEdges = this.edges.filter(e => e.source === nodeId);
    
    for (const edge of outgoingEdges) {
      downstream.add(edge.target);
      // Recursively get downstream nodes, but avoid infinite loops
      const nestedDownstream = this.getDownstreamNodes(edge.target, new Set(visited));
      nestedDownstream.forEach(id => downstream.add(id));
    }
    
    return downstream;
  }

  /**
   * Process Loop node using edge buffer approach (like frontend)
   */
  private processLoopNode(node: WorkflowNode): any {
    const edgeBuffer = this.edgeBuffers.get(node.id);
    if (!edgeBuffer || Object.keys(edgeBuffer).length === 0) {
      console.log(`🔄 [LOOP] No edge buffer data for Loop ${node.id}, returning empty result`);
      return [];
    }

    // Get all outgoing edges from Loop node to determine sourceHandle filtering
    const outgoingEdges = this.edges.filter(e => e.source === node.id);
    const doneEdges = outgoingEdges.filter(e => e.sourceHandle === 'done');
    
    // Aggregate all results from edge buffer
    const aggregatedResults = Object.values(edgeBuffer).flat();
    
    console.log(`🔄 [LOOP] Processing Loop ${node.id} with ${aggregatedResults.length} aggregated items from edge buffer`);
    
    // If there are "done" edges, this means we should output the aggregated results
    if (doneEdges.length > 0) {
      console.log(`🔄 [LOOP] Loop ${node.id} has "done" edges, outputting aggregated results`);
      return aggregatedResults;
    }
    
    // Otherwise, return the aggregated results (default behavior)
    return aggregatedResults;
  }
}

/**
 * Factory function to execute a workflow
 */
export async function executeWorkflow(runId: string, workflowId: string, userId: string, nodes: any[], edges: any[]): Promise<{ success: boolean; result?: any; error?: string }> {
  const maxParallel = parseInt(process.env.WORKFLOW_MAX_PARALLELISM || '4');
  const workflowEngine = new WorkflowEngine(runId, workflowId, userId, nodes, edges, maxParallel);
  return await workflowEngine.execute();
}