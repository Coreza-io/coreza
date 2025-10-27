import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from '../types';

export class UtilityExecutor implements INodeExecutor {
  readonly category = 'Utility';

  async execute(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    try {
      const nodeType = node.type;
      
      switch (nodeType) {
        case 'Scheduler':
        case 'trigger':
          return this.executeSchedulerNode(node, input, context);
        case 'Visualize':
          return this.executeVisualizeNode(node, input, context);
        case 'webhook':
          return this.executeWebhookNode(node, input, context);
        case 'httprequest':
          return this.executeHttpNode(node, input, context);
        default:
          return {
            success: false,
            error: `Unsupported utility node type: ${nodeType}`
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Utility execution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async executeSchedulerNode(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    // Scheduler nodes typically just pass through data since they're triggered externally
    return {
      success: true,
      data: {
        ...input,
        triggered_at: new Date().toISOString(),
        node_id: node.id
      }
    };
  }

  private async executeVisualizeNode(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    const resolvedParams = context?.resolveNodeParameters ? 
      context.resolveNodeParameters(node, input) : 
      { ...node.values, ...input };

    console.log('📊 Visualize node processing data:', resolvedParams);

    return {
      success: true,
      data: {
        visualization: {
          type: resolvedParams.chartType || 'line',
          data: resolvedParams.data || input,
          config: resolvedParams.config || {},
          timestamp: new Date().toISOString()
        }
      }
    };
  }

  private async executeWebhookNode(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    // Webhook nodes typically receive data, so we just process and return it
    return {
      success: true,
      data: {
        ...input,
        webhook_received_at: new Date().toISOString(),
        node_id: node.id
      }
    };
  }

  private async executeHttpNode(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    const resolvedParams = context?.resolveNodeParameters ? 
      context.resolveNodeParameters(node, input) : 
      { ...node.values, ...input };

    console.log('🌐 HTTP request node execution:', resolvedParams);

    // This would typically make an HTTP request using the HTTP service
    // For now, returning a placeholder response
    return {
      success: true,
      data: {
        request: resolvedParams,
        response: {
          status: 200,
          data: 'HTTP request executed',
          timestamp: new Date().toISOString()
        }
      }
    };
  }
}