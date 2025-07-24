import { supabase } from '../config/supabase';
import axios from 'axios';
import { IndicatorService } from './indicators';
import { BrokerService } from './brokers';
import { CommunicationService } from './communications';
import { DataService } from './data';
import { HttpService } from './http';
import { WebhookService } from './webhooks';
import { ComparatorService } from './comparator';

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

      if (!allDependenciesSatisfied) {
        // Re-queue the node for later execution
        queue.push(nodeId);
        retryCount++;
        console.log(`⏳ [WORKFLOW] Dependencies not satisfied for ${nodeId} (${node.type}), re-queuing (retry ${retryCount}) - Run: ${this.runId}`);
        continue;
      }

      try {
        console.log(`🔄 [WORKFLOW] Executing node: ${nodeId} (${node.type}) - Run: ${this.runId}`);
        await this.executeNode(node);
        this.executedNodes.add(nodeId);
        console.log(`✅ [WORKFLOW] Node ${nodeId} (${node.type}) completed successfully - Run: ${this.runId}`);
        
        // Handle conditional routing for branching nodes
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
        case 'Alpaca':
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
        case 'Scheduler':
        case 'trigger':
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
    return await IndicatorService.calculate(indicatorType, input);
  }

  private async executeDhanNode(node: WorkflowNode, input: any): Promise<any> {
    const operation = node.data?.operation || 'get_account';
    const result = await BrokerService.execute('dhan', { ...input, operation });
    
    if (!result.success) {
      throw new Error(result.error || 'Dhan operation failed');
    }
    
    return result.data;
  }

  private async executeAlpacaNode(node: WorkflowNode, input: any): Promise<any> {
    const operation = node.data?.operation || 'get_account';
    const result = await BrokerService.execute('alpaca', { ...input, operation });
    
    if (!result.success) {
      throw new Error(result.error || 'Alpaca operation failed');
    }
    
    return result.data;
  }

  private async executeMarketNode(node: WorkflowNode, input: any): Promise<any> {
    const operation = node.data?.operation || 'get_quote';
    const result = await DataService.execute('market', operation, input);
    
    if (!result.success) {
      throw new Error(result.error || 'Market operation failed');
    }
    
    return result.data;
  }

  private async executeIfNode(node: WorkflowNode, input: any): Promise<any> {
    const condition = this.resolveValue(node.data.condition, input);
    const left = this.resolveValue(condition.left, input);
    const operator = condition.operator || '==';
    const right = this.resolveValue(condition.right, input);

    const result = await ComparatorService.executeIf({ left, operator, right });
    
    if (!result.success) {
      throw new Error(result.error || 'Condition evaluation failed');
    }

    return { condition_met: result.result, ...input };
  }

  private async executeSwitchNode(node: WorkflowNode, input: any): Promise<any> {
    const cases = node.data.cases || [];
    const defaultValue = node.data.defaultValue;

    const switchCases = cases.map((c: any) => ({
      condition: {
        left: this.resolveValue(c.condition?.left, input),
        operator: c.condition?.operator || '==',
        right: this.resolveValue(c.condition?.right, input)
      },
      value: this.resolveValue(c.value, input)
    }));

    const result = await ComparatorService.executeSwitch(switchCases, defaultValue);
    
    if (!result.success) {
      throw new Error(result.error || 'Switch evaluation failed');
    }

    return { switch_result: result.result, matched_case: result.matchedCase, ...input };
  }

  private async executeSchedulerNode(node: WorkflowNode, input: any): Promise<any> {
    // Scheduler nodes are triggers that pass through data and provide scheduling metadata
    const scheduleData = node.data || {};
    
    // Generate cron expression from scheduler data if available
    let cronExpression = null;
    if (scheduleData.interval && scheduleData.count) {
      const hour = scheduleData.hour || 0;
      const minute = scheduleData.minute || 0;
      
      if (scheduleData.interval === 'daily') {
        cronExpression = `${minute} ${hour} * * *`;
      } else if (scheduleData.interval === 'weekly') {
        cronExpression = `${minute} ${hour} * * 0`;
      } else if (scheduleData.interval === 'monthly') {
        cronExpression = `${minute} ${hour} 1 * *`;
      }
    }
    
    return {
      ...input,
      trigger: {
        type: 'scheduler',
        scheduled: true,
        scheduledAt: new Date().toISOString(),
        scheduleConfig: {
          interval: scheduleData.interval,
          count: scheduleData.count,
          hour: scheduleData.hour,
          minute: scheduleData.minute,
          ...(cronExpression && { cronExpression })
        }
      }
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
    const operation = node.data?.operation || 'trigger';
    const result = await WebhookService.execute(operation, input);
    
    if (!result.success) {
      throw new Error(result.error || 'Webhook operation failed');
    }
    
    return result.data;
  }

  private async executeHttpNode(node: WorkflowNode, input: any): Promise<any> {
    const result = await HttpService.execute(input);
    
    if (!result.success) {
      throw new Error(result.error || 'HTTP request failed');
    }
    
    return result;
  }

  private async executeGmailNode(node: WorkflowNode, input: any): Promise<any> {
    const operation = node.data?.operation || 'send';
    const result = await CommunicationService.execute('gmail', operation, input);
    
    if (!result.success) {
      throw new Error(result.error || 'Gmail operation failed');
    }
    
    return result.data;
  }

  private async executeFinnhubNode(node: WorkflowNode, input: any): Promise<any> {
    const operation = node.data?.operation || 'get_quote';
    const result = await DataService.execute('finnhub', operation, input);
    
    if (!result.success) {
      throw new Error(result.error || 'FinnHub operation failed');
    }
    
    return result.data;
  }

  private async executeYahooFinanceNode(node: WorkflowNode, input: any): Promise<any> {
    const operation = node.data?.operation || 'get_quote';
    const result = await DataService.execute('yahoofinance', operation, input);
    
    if (!result.success) {
      throw new Error(result.error || 'Yahoo Finance operation failed');
    }
    
    return result.data;
  }

  private async executeWhatsappNode(node: WorkflowNode, input: any): Promise<any> {
    const operation = node.data?.operation || 'send';
    const result = await CommunicationService.execute('whatsapp', operation, input);
    
    if (!result.success) {
      throw new Error(result.error || 'WhatsApp operation failed');
    }
    
    return result.data;
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