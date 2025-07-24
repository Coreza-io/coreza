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

  constructor(runId: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) {
    this.runId = runId;
    this.nodes = nodes;
    this.edges = edges;
  }

  async execute(): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      // Get execution order using topological sort
      const executionOrder = this.getExecutionOrder();
      
      if (!executionOrder) {
        throw new Error('Circular dependency detected in workflow');
      }

      console.log(`Starting workflow execution for run ${this.runId}`);
      console.log(`Execution order: ${executionOrder.join(' -> ')}`);

      // Execute nodes in order
      for (const nodeId of executionOrder) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) {
          throw new Error(`Node ${nodeId} not found`);
        }

        try {
          await this.executeNode(node);
        } catch (error) {
          console.error(`Failed to execute node ${nodeId}:`, error);
          await this.markRunAsFailed(error.message);
          return { success: false, error: error.message };
        }
      }

      // Mark workflow as completed
      await this.markRunAsCompleted();
      
      // Get final results
      const finalResults = Array.from(this.nodeResults.entries()).reduce((acc, [nodeId, result]) => {
        acc[nodeId] = result;
        return acc;
      }, {} as Record<string, any>);

      return { success: true, result: finalResults };
    } catch (error) {
      console.error('Workflow execution failed:', error);
      await this.markRunAsFailed(error.message);
      return { success: false, error: error.message };
    }
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
        case 'market':
          result = await this.executeMarketNode(node, nodeInput);
          break;
        case 'if':
          result = await this.executeIfNode(node, nodeInput);
          break;
        case 'scheduler':
          result = await this.executeSchedulerNode(node, nodeInput);
          break;
        case 'visualize':
          result = await this.executeVisualizeNode(node, nodeInput);
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

  private getExecutionOrder(): string[] | null {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: string[] = [];

    const visit = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) {
        return false; // Circular dependency
      }
      if (visited.has(nodeId)) {
        return true;
      }

      visiting.add(nodeId);

      // Visit all upstream nodes first
      const upstreamNodes = this.getUpstreamNodes(nodeId);
      for (const upstreamId of upstreamNodes) {
        if (!visit(upstreamId)) {
          return false;
        }
      }

      visiting.delete(nodeId);
      visited.add(nodeId);
      result.push(nodeId);
      return true;
    };

    // Visit all nodes
    for (const node of this.nodes) {
      if (!visit(node.id)) {
        return null; // Circular dependency detected
      }
    }

    return result;
  }

  private async executeInputNode(node: WorkflowNode, input: any): Promise<any> {
    // Input nodes just pass through their data
    return { ...node.data, timestamp: new Date().toISOString() };
  }

  private async executeIndicatorNode(node: WorkflowNode, input: any): Promise<any> {
    const indicatorType = node.type.toLowerCase();
    const apiUrl = `http://localhost:8000/api/indicators/${indicatorType}`;
    
    const response = await axios.post(apiUrl, input, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    return response.data;
  }

  private async executeAlpacaNode(node: WorkflowNode, input: any): Promise<any> {
    const action = node.data.action || 'account';
    const apiUrl = `http://localhost:8000/api/alpaca/${action}`;
    
    const response = await axios.post(apiUrl, input, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    return response.data;
  }

  private async executeMarketNode(node: WorkflowNode, input: any): Promise<any> {
    const action = node.data.action || 'quote';
    const apiUrl = `http://localhost:8000/api/market/${action}`;
    
    const response = await axios.post(apiUrl, input, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    return response.data;
  }

  private async executeIfNode(node: WorkflowNode, input: any): Promise<any> {
    const { condition, operator = '>', value } = node.data;
    
    if (!condition || value === undefined) {
      throw new Error('If node requires condition and value');
    }

    // Resolve condition value from input
    const conditionValue = this.resolveValue(condition, input);
    const compareValue = this.resolveValue(value, input);
    
    let result = false;
    switch (operator) {
      case '>':
        result = conditionValue > compareValue;
        break;
      case '<':
        result = conditionValue < compareValue;
        break;
      case '>=':
        result = conditionValue >= compareValue;
        break;
      case '<=':
        result = conditionValue <= compareValue;
        break;
      case '==':
        result = conditionValue == compareValue;
        break;
      case '!=':
        result = conditionValue != compareValue;
        break;
      default:
        throw new Error(`Unknown operator: ${operator}`);
    }

    return {
      condition: result,
      conditionValue,
      compareValue,
      operator,
      input
    };
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