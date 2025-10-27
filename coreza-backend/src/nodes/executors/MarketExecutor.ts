import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from '../types';
import { DataService } from '../../services/data';

export class MarketExecutor implements INodeExecutor {
  readonly category = 'Market';

  async execute(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    try {
      const resolvedParams = context?.resolveNodeParameters ? 
        context.resolveNodeParameters(node, input) : 
        { ...node.values, ...input };

      console.log('🏪 Executing Market node with params:', resolvedParams);

      const result = await DataService.getMarketData(resolvedParams);
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Market data fetch failed'
        };
      }

      return {
        success: true,
        data: result.data
      };
    } catch (error) {
      return {
        success: false,
        error: `Market execution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}