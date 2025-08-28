import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from '../types';
import { DataService } from '../../services/data';

export class DataSourceExecutor implements INodeExecutor {
  readonly category = 'DataSource';

  async execute(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    try {
      const nodeType = node.type;
      const operation = node.values?.operation || 'get_quote';

      // Resolve and merge node parameters with input data
      const resolvedParams = context?.resolveNodeParameters ? 
        context.resolveNodeParameters(node, input) : 
        { ...node.values, ...input };

      const combinedInput = {
        ...input,
        ...resolvedParams
      };

      let result;
      switch (nodeType) {
        case 'FinnHub':
          result = await DataService.execute('finnhub', operation, combinedInput);
          break;
        case 'YahooFinance':
          result = await DataService.execute('yahoofinance', operation, combinedInput);
          break;
        default:
          return {
            success: false,
            error: `Unsupported data source node type: ${nodeType}`
          };
      }

      if (!result.success) {
        return {
          success: false,
          error: result.error || `${nodeType} ${operation} operation failed`
        };
      }

      return {
        success: true,
        data: result.data
      };
    } catch (error) {
      return {
        success: false,
        error: `Data source execution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}