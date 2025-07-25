import { supabase } from '../config/supabase';
import axios from 'axios';
import { IndicatorService } from './indicators';
import { BrokerService } from './brokers';
import { CommunicationService } from './communications';
import { DataService } from './data';
import { HttpService } from './http';
import { WebhookService } from './webhooks';
import { ComparatorService } from './comparator';
import { getNodeExecutor } from '../nodes/registry';
import { NodeInput, NodeResult } from '../nodes/types';

interface WorkflowNode {
  id: string;
  type: string;
  category: string;
  data: any;
  values?: any;
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
  private userId: string;

  constructor(runId: string, userId: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) {
    this.runId = runId;
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
      
      // Execute using registry-based approach
      const result = await this.executeNodeWithRegistry(node, nodeInput);

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

  /**
   * Execute node using registry-based approach
   */
  private async executeNodeWithRegistry(node: WorkflowNode, input: NodeInput): Promise<any> {
    // Map node categories to ensure compatibility
    let category = node.category;
    
    // Handle special category mappings for existing nodes
    if (node.type === 'If' || node.type === 'Switch') {
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
      resolveNodeParameters: (node: WorkflowNode, input: NodeInput) => this.resolveNodeParameters(node, input)
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


  private async executeBrokerNode(node: WorkflowNode, input: any): Promise<any> {
    const operation = node.values?.operation;
    const broker = node.values?.type;
    const credential_id = node.values?.credential_id;
    
    if (!credential_id) {
      throw new Error(`${broker} credential_id is required`);
    }

    // Resolve and merge node parameters with input data
    const resolvedParams = this.resolveNodeParameters(node, input);
    
    const result = await BrokerService.execute(broker, { 
      user_id: this.userId,
      credential_id,
      operation,
      ...input,
      ...resolvedParams
    });
    
    if (!result.success) {
      throw new Error(result.error || `${broker} ${operation} operation failed`);
    }
    
    return result.data;
  }

  private async executeAlpacaNode(node: WorkflowNode, input: any): Promise<any> {
    const operation = node.values?.operation || 'get_account';
    const credential_id = node.values?.credential_id;
    
    if (!credential_id) {
      throw new Error('Alpaca credential_id is required');
    }

    // Resolve and merge node parameters with input data
    const resolvedParams = this.resolveNodeParameters(node, input);
    
    const result = await BrokerService.execute('alpaca', { 
      user_id: this.userId,
      credential_id,
      operation,
      ...input,
      ...resolvedParams
    });
    
    if (!result.success) {
      throw new Error(result.error || 'Alpaca operation failed');
    }
    
    return result.data;
  }

  private async executeMarketNode(node: WorkflowNode, input: any): Promise<any> {
    const operation = node.values?.operation || 'get_quote';
    const result = await DataService.execute('market', operation, input);
    
    if (!result.success) {
      throw new Error(result.error || 'Market operation failed');
    }
    
    return result.data;
  }

  private async executeIfNode(node: WorkflowNode, input: any): Promise<any> {
    // Get all node data for cross-references
    const allNodeData: Record<string, any> = {};
    for (const [nodeId, result] of this.nodeResults.entries()) {
      allNodeData[nodeId] = result;
    }

    const conditions = node.values?.conditions || [];
    
    // Resolve each condition's left and right values
    const resolvedConditions = conditions.map((condition: any) => ({
      left: typeof condition.left === 'string' 
        ? this.resolveReferences(condition.left, input, allNodeData)
        : condition.left,
      operator: condition.operator || '===',
      right: typeof condition.right === 'string'
        ? this.resolveReferences(condition.right, input, allNodeData)
        : condition.right
    }));

    const result = await ComparatorService.executeIf({ conditions: resolvedConditions });
    
    if (!result.success) {
      throw new Error(result.error || 'Condition evaluation failed');
    }

    return { condition_met: result.result, ...input };
  }

  private async executeSwitchNode(node: WorkflowNode, input: any): Promise<any> {
    // Get all node data for cross-references
    const allNodeData: Record<string, any> = {};
    for (const [nodeId, result] of this.nodeResults.entries()) {
      allNodeData[nodeId] = result;
    }

    const inputValue = node.values?.inputValue;
    const cases = node.values?.cases || [];
    const defaultCase = node.values?.defaultCase || 'default';

    // Resolve the input value
    const resolvedInputValue = typeof inputValue === 'string'
      ? this.resolveReferences(inputValue, input, allNodeData)
      : inputValue;

    // Resolve case values and create switch cases
    const resolvedCases = cases.map((c: any) => ({
      caseValue: typeof c.caseValue === 'string'
        ? this.resolveReferences(c.caseValue, input, allNodeData)
        : c.caseValue,
      caseName: c.caseName || c.caseValue
    }));

    const result = await ComparatorService.executeSwitch({ 
      inputValue: resolvedInputValue, 
      cases: resolvedCases, 
      defaultCase 
    });
    
    if (!result.success) {
      throw new Error(result.error || 'Switch evaluation failed');
    }

    return { switch_result: result.result, matched_case: result.matchedCase, ...input };
  }

  private async executeSchedulerNode(node: WorkflowNode, input: any): Promise<any> {
    // Scheduler nodes are triggers that pass through data and provide scheduling metadata
    const scheduleData = node.values || {};
    
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
        type: node.values?.chart_type || 'line',
        data: input,
        timestamp: new Date().toISOString()
      }
    };
  }

  private async executeWebhookNode(node: WorkflowNode, input: any): Promise<any> {
    const operation = node.values?.operation || 'trigger';
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
    const operation = node.values?.operation || 'send';

    // Resolve and merge node parameters with input data
    const resolvedParams = this.resolveNodeParameters(node, input);
    const combinedInput = {
      ...input,
      ...resolvedParams
    };
    
    const result = await CommunicationService.execute('gmail', operation, combinedInput);
    
    if (!result.success) {
      throw new Error(result.error || 'Gmail operation failed');
    }
    
    return result.data;
  }

  private async executeFinnhubNode(node: WorkflowNode, input: any): Promise<any> {
    const operation = node.values?.operation || 'get_quote';

    // Resolve and merge node parameters with input data
    const resolvedParams = this.resolveNodeParameters(node, input);
    const combinedInput = {
      ...input,
      ...resolvedParams
    };
    
    const result = await DataService.execute('finnhub', operation, combinedInput);
    
    if (!result.success) {
      throw new Error(result.error || 'FinnHub operation failed');
    }
    
    return result.data;
  }

  private async executeYahooFinanceNode(node: WorkflowNode, input: any): Promise<any> {
    const operation = node.values?.operation || 'get_quote';

    // Resolve and merge node parameters with input data
    const resolvedParams = this.resolveNodeParameters(node, input);
    const combinedInput = {
      ...input,
      ...resolvedParams
    };
    
    const result = await DataService.execute('yahoofinance', operation, combinedInput);
    
    if (!result.success) {
      throw new Error(result.error || 'Yahoo Finance operation failed');
    }
    
    return result.data;
  }

  private async executeWhatsappNode(node: WorkflowNode, input: any): Promise<any> {
    const operation = node.values?.operation || 'send';

    // Resolve and merge node parameters with input data
    const resolvedParams = this.resolveNodeParameters(node, input);
    const combinedInput = {
      ...input,
      ...resolvedParams
    };
    
    const result = await CommunicationService.execute('whatsapp', operation, combinedInput);
    
    if (!result.success) {
      throw new Error(result.error || 'WhatsApp operation failed');
    }
    
    return result.data;
  }

  /**
   * Turn a path like "0.candles[1].value" or "['foo'].bar" into an array of keys/indexes.
   * Now supports negative numbers (e.g. -1, -2).
   */
  private parsePath(path: string): Array<string|number> {
    const parts: Array<string|number> = [];
    const regex = /([^[.\]]+)|\[(\-?\d+|["'][^"']+["'])\]/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(path))) {
      const [ , dotKey, bracketKey ] = match;
      if (dotKey !== undefined) {
        parts.push(dotKey);
      } else {
        // bracketKey is either a quoted string or a number (possibly negative)
        if (/^-?\d+$/.test(bracketKey!)) {
          parts.push(Number(bracketKey));      // e.g. "-1" → -1
        } else {
          parts.push(bracketKey!.slice(1, -1)); // strip quotes from 'foo' or "foo"
        }
      }
    }

    return parts;
  }

  /**
   * Create display name mapping from node array
   */
  private createDisplayNameMapping(): Record<string, string> {
    const mapping: Record<string, string> = {};
    this.nodes.forEach(node => {
      const displayName = this.generateDisplayName(node);
      mapping[displayName] = node.id;
    });
    return mapping;
  }

  /**
   * Generate display name for a node
   */
  private generateDisplayName(node: WorkflowNode): string {
    // Use custom label if provided
    if (node.values?.label && node.values.label.trim()) {
      return node.values.label.trim();
    }
    
    // Use definition name if available
    if (node.data?.definition?.name) {
      return node.data.definition.name;
    }
    
    // Fallback to node type
    return node.type || 'Unknown';
  }

  /**
   * Replaces {{ $json.x.y }} or {{ $('Node').json.x.y }} templates using inputData.
   * Now with support for negative array indexes, multi-node data lookup, and display name resolution.
   */
  private resolveReferences(
    expr: string, 
    inputData: any, 
    allNodeData?: Record<string, any>
  ): string {
    if (!inputData || typeof expr !== 'string') {
      return expr;
    }

    // Match $('NodeName').json.path or $json.path patterns
    const templateRegex = /\{\{\s*(?:\$\('([^']+)'\)\.json|\$json)(?:\.|\s*)([^\}]*?)\s*\}\}/g;

    return expr.replace(templateRegex, (fullMatch, nodeName, rawPath) => {
      console.log("🔍 [BACKEND] Resolving reference:", { fullMatch, nodeName, rawPath, inputData, allNodeData });
      
      let targetData = inputData;
      
      // If nodeName is specified and we have allNodeData, look up the specific node's data
      if (nodeName && allNodeData) {
        // First try direct lookup by node name
        if (allNodeData[nodeName]) {
          targetData = allNodeData[nodeName];
          console.log(`🔍 [BACKEND] Found data for node '${nodeName}':`, targetData);
        } else {
          // Try lookup by display name if direct lookup fails
          const displayNameMapping = this.createDisplayNameMapping();
          const nodeId = displayNameMapping[nodeName];
          
          if (nodeId && allNodeData[nodeId]) {
            targetData = allNodeData[nodeId];
            console.log(`🔍 [BACKEND] Found data for node '${nodeName}' via display name mapping (ID: ${nodeId}):`, targetData);
          } else {
            console.warn(`🔍 [BACKEND] No data found for node '${nodeName}', available nodes:`, Object.keys(allNodeData));
            console.warn(`🔍 [BACKEND] Available display names:`, Object.keys(displayNameMapping));
            return fullMatch; // Return original if node not found
          }
        }
        
        // Handle nested json structure for Market Status and other nodes
        if (targetData && targetData.json) {
          targetData = targetData.json;
          console.log(`🔍 [BACKEND] Using nested json data:`, targetData);
        }
      }
      
      const cleanPath = rawPath?.trim().replace(/^[.\s]+/, '') || '';
      
      // If no path specified (e.g., just {{ $('Alpaca').json }}), return the whole object
      if (!cleanPath) {
        return (typeof targetData === 'object' && targetData !== null)
          ? JSON.stringify(targetData)
          : String(targetData);
      }
      
      const keys = this.parsePath(cleanPath);
      console.log("🔍 [BACKEND] Parsed keys:", keys);

      let result: any = targetData;
      for (const key of keys) {
        if (result == null) { 
          result = undefined; 
          break; 
        }

        // If we're indexing into an array with a number...
        if (Array.isArray(result) && typeof key === 'number') {
          // handle negative indexes
          const idx = key >= 0 ? key : result.length + key;
          result = result[idx];
        } else {
          result = result[key as keyof typeof result];
        }
      }

      console.log("🔍 [BACKEND] Final result:", result);

      if (result === undefined) {
        // leave original placeholder if not found
        return fullMatch;
      }

      return (typeof result === 'object' && result !== null)
        ? JSON.stringify(result)
        : String(result);
    });
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
      if (key !== 'credential_id' && key !== 'operation') {
        if (typeof value === 'string') {
          resolvedParams[key] = this.resolveReferences(value, input, allNodeData);
        } else {
          resolvedParams[key] = value;
        }
      }
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
}

// Factory function to create and execute workflows
export async function executeWorkflow(
  runId: string,
  userId: string,
  nodes: WorkflowNode[], 
  edges: WorkflowEdge[]
): Promise<{ success: boolean; result?: any; error?: string }> {
  const engine = new WorkflowEngine(runId, userId, nodes, edges);
  return await engine.execute();
}