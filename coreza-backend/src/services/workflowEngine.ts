import { supabase } from '../config/supabase';
import axios from 'axios';

interface WorkflowNode {
  id: string;
  type: string;
  data: any;
  position: { x: number; y: number };
}

interface WorkflowEdge {
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
  private nodes: WorkflowNode[];
  private edges: WorkflowEdge[];
  private executions: Map<string, NodeExecution> = new Map();
  private nodeResults: Map<string, any> = new Map();
  private conditionalMap = new Map<string, Record<string, string>>();
  private executedNodes = new Set<string>();

  constructor(runId: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) {
    this.runId = runId;
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
      const isBranchingNode = ['if', 'switch', 'router'].includes(sourceNode?.type?.toLowerCase() || '');
      
      if (edge.sourceHandle && isBranchingNode) {
        const entry = this.conditionalMap.get(edge.source) || {};
        entry[edge.sourceHandle] = edge.target;
        this.conditionalMap.set(edge.source, entry);
      }
    });
    
    console.log(`🗺️ [WORKFLOW ENGINE] Built conditional map for ${this.conditionalMap.size} branching nodes:`, Array.from(this.conditionalMap.keys()));
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
      if (this.detectCycles()) {
        throw new Error('Circular dependency detected in workflow');
      }

      console.log(`🚀 Starting queue-based workflow execution for run ${this.runId}`);
      
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

      if (!allDependenciesSatisfied) {
        // Re-queue the node for later execution
        queue.push(nodeId);
        retryCount++;
        console.log(`⏳ Dependencies not satisfied for ${nodeId}, re-queuing (retry ${retryCount})`);
        continue;
      }

      try {
        console.log(`🔄 Executing node: ${nodeId} (${node.type})`);
        await this.executeNode(node);
        this.executedNodes.add(nodeId);
        
        // Handle conditional routing for branching nodes
        const isBranchingNode = this.conditionalMap.has(nodeId);
        if (isBranchingNode) {
          await this.handleBranchNodeResult(nodeId, this.nodeResults.get(nodeId));
        } else {
          // Add downstream nodes to queue for non-branching nodes
          this.addDownstreamNodesToQueue(nodeId, queue);
        }
        
        retryCount = 0; // Reset retry count on successful execution
      } catch (error) {
        console.error(`❌ Failed to execute node ${nodeId}:`, error);
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
    // Normalize result to handle key
    let handleKey: string;
    
    if (typeof result === 'boolean') {
      handleKey = result.toString(); // "true" or "false"
    } else if (result && typeof result === 'object') {
      // Handle If node format: check for result field
      if ('result' in result) {
        handleKey = result.result; // "true" or "false" from comparator
      } else if ('output' in result) {
        handleKey = result.output; // Switch case output
      } else {
        handleKey = 'default';
      }
    } else {
      handleKey = String(result);
    }

    // Look up the branch map
    const branchMap = this.conditionalMap.get(nodeId) || {};
    const targetId = branchMap[handleKey];

    if (!targetId) {
      console.warn(`⚠️ No branch found for node ${nodeId} handle "${handleKey}". Available handles:`, Object.keys(branchMap));
      return;
    }

    console.log(`🔀 Branch node ${nodeId} → handle "${handleKey}" → ${targetId}`);
    
    // Execute the targeted branch
    await this.executeConditionalChain(targetId);
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
      const nodeInput = this.getNodeInput(node);
      
      // Execute based on node type
      let result;
      switch (node.type) {
        case 'input':
          result = await this.executeInputNode(node, nodeInput);
          break;
        case 'ema':
        case 'rsi':
        case 'macd':
        case 'bollinger':
        case 'adx':
        case 'stochastic':
        case 'ichimoku':
          result = await this.executeIndicatorNode(node, nodeInput);
          break;
        case 'alpaca':
          result = await this.executeAlpacaNode(node, nodeInput);
          break;
        case 'dhan':
          result = await this.executeDhanNode(node, nodeInput);
          break;
        case 'market':
          result = await this.executeMarketNode(node, nodeInput);
          break;
        case 'if':
          result = await this.executeIfNode(node, nodeInput);
          break;
        case 'switch':
          result = await this.executeSwitchNode(node, nodeInput);
          break;
        case 'scheduler':
          result = await this.executeSchedulerNode(node, nodeInput);
          break;
        case 'visualize':
          result = await this.executeVisualizeNode(node, nodeInput);
          break;
        case 'webhook':
          result = await this.executeWebhookNode(node, nodeInput);
          break;
        case 'http':
        case 'httprequest':
          result = await this.executeHttpNode(node, nodeInput);
          break;
        case 'gmail':
          result = await this.executeGmailNode(node, nodeInput);
          break;
        case 'finnhub':
          result = await this.executeFinnhubNode(node, nodeInput);
          break;
        case 'yahoofinance':
          result = await this.executeYahooFinanceNode(node, nodeInput);
          break;
        case 'whatsapp':
          result = await this.executeWhatsappNode(node, nodeInput);
          break;
        default:
          throw new Error(`Unknown node type: ${node.type}`);
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


  private async executeInputNode(node: WorkflowNode, input: any): Promise<any> {
    // Input nodes just pass through their data
    return { ...node.data, timestamp: new Date().toISOString() };
  }

  private async executeIndicatorNode(node: WorkflowNode, input: any): Promise<any> {
    const indicatorType = node.type.toLowerCase();
    const apiUrl = `http://localhost:8000/indicators/${indicatorType}`;
    
    const response = await axios.post(apiUrl, input, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    return response.data;
  }

  private async executeDhanNode(node: WorkflowNode, input: any): Promise<any> {
    const action = node.data.action || 'funds';
    const apiUrl = `http://localhost:8000/dhan/${action}`;
    
    const response = await axios.post(apiUrl, input, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    return response.data;
  }

  private async executeAlpacaNode(node: WorkflowNode, input: any): Promise<any> {
    const action = node.data.action || 'account';
    const apiUrl = `http://localhost:8000/alpaca/${action}`;
    
    const response = await axios.post(apiUrl, input, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    return response.data;
  }

  private async executeMarketNode(node: WorkflowNode, input: any): Promise<any> {
    const action = node.data.action || 'quote';
    const apiUrl = `http://localhost:8000/market/${action}`;
    
    const response = await axios.post(apiUrl, input, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    return response.data;
  }

  private async executeIfNode(node: WorkflowNode, input: any): Promise<any> {
    const { conditions } = node.data;
    
    if (!conditions || !Array.isArray(conditions)) {
      throw new Error('If node requires conditions array');
    }

    // Resolve template values in conditions
    const resolvedConditions = conditions.map(condition => ({
      left: this.resolveValue(condition.left, input),
      operator: condition.operator,
      right: this.resolveValue(condition.right, input)
    }));

    // Call the comparator API
    const apiUrl = `http://localhost:8000/comparator/if`;
    
    const response = await axios.post(apiUrl, {
      conditions: resolvedConditions
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    console.log(`🔍 If node ${node.id} result:`, response.data);
    return response.data;
  }

  private async executeSwitchNode(node: WorkflowNode, input: any): Promise<any> {
    const { inputValue, cases = [], defaultCase = 'default' } = node.data;
    
    if (inputValue === undefined) {
      throw new Error('Switch node requires inputValue');
    }

    // Resolve the input value
    const resolvedInputValue = this.resolveValue(inputValue, input);

    // Resolve case values
    const resolvedCases = cases.map((caseItem: any) => ({
      caseValue: this.resolveValue(caseItem.caseValue, input),
      caseName: caseItem.caseName || caseItem.caseValue
    }));

    // Call the comparator API
    const apiUrl = `http://localhost:8000/comparator/switch`;
    
    const response = await axios.post(apiUrl, {
      inputValue: resolvedInputValue,
      cases: resolvedCases,
      defaultCase
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    console.log(`🔀 Switch node ${node.id} result:`, response.data);
    return response.data;
  }

  private async executeSchedulerNode(node: WorkflowNode, input: any): Promise<any> {
    // Scheduler nodes just pass through data and set scheduling metadata
    return {
      ...input,
      scheduled: true,
      scheduledAt: new Date().toISOString(),
      cronExpression: node.data.cron_expression
    };
  }

  private async executeVisualizeNode(node: WorkflowNode, input: any): Promise<any> {
    // Visualize nodes process data for charts/graphs
    return {
      ...input,
      visualization: {
        type: node.data.chart_type || 'line',
        data: input,
        timestamp: new Date().toISOString()
      }
    };
  }

  private async executeWebhookNode(node: WorkflowNode, input: any): Promise<any> {
    const action = node.data.action || 'send';
    const apiUrl = `http://localhost:8000/webhooks/${action}`;
    
    const response = await axios.post(apiUrl, input, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    return response.data;
  }

  private async executeHttpNode(node: WorkflowNode, input: any): Promise<any> {
    const apiUrl = `http://localhost:8000/http/request`;
    
    const response = await axios.post(apiUrl, input, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    return response.data;
  }

  private async executeGmailNode(node: WorkflowNode, input: any): Promise<any> {
    const action = node.data.action || 'send';
    const apiUrl = `http://localhost:8000/gmail/${action}`;
    
    const response = await axios.post(apiUrl, input, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    return response.data;
  }

  private async executeFinnhubNode(node: WorkflowNode, input: any): Promise<any> {
    const action = node.data.action || 'quote';
    const apiUrl = `http://localhost:8000/finnhub/${action}`;
    
    const response = await axios.post(apiUrl, input, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    return response.data;
  }

  private async executeYahooFinanceNode(node: WorkflowNode, input: any): Promise<any> {
    const action = node.data.action || 'quote';
    const apiUrl = `http://localhost:8000/yahoofinance/${action}`;
    
    const response = await axios.post(apiUrl, input, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    return response.data;
  }

  private async executeWhatsappNode(node: WorkflowNode, input: any): Promise<any> {
    const action = node.data.action || 'send';
    const apiUrl = `http://localhost:8000/whatsapp/${action}`;
    
    const response = await axios.post(apiUrl, input, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    return response.data;
  }

  private resolveValue(value: any, context: any): any {
    if (typeof value === 'string' && value.startsWith('$')) {
      // Reference to context value
      const key = value.substring(1);
      return this.getNestedValue(context, key);
    }
    return value;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
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
}

// Factory function to create and execute workflows
export async function executeWorkflow(
  runId: string, 
  nodes: WorkflowNode[], 
  edges: WorkflowEdge[]
): Promise<{ success: boolean; result?: any; error?: string }> {
  const engine = new WorkflowEngine(runId, nodes, edges);
  return await engine.execute();
}