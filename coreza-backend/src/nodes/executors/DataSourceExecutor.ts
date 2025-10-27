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

      // Special handling for backtesting - ensure historical data operations
      if (resolvedParams.historical || resolvedParams.start_date || resolvedParams.end_date) {
        resolvedParams.operation = 'get_historical_data';
      }

      const combinedInput = {
        ...input,
        ...resolvedParams
      };

      console.log(`🔍 [DataSource] Executing ${nodeType} with params:`, combinedInput);

      let result;
      switch (nodeType) {
        case 'FinnHub':
          result = await DataService.execute('finnhub', resolvedParams.operation, combinedInput);
          break;
        case 'YahooFinance':
          result = await DataService.execute('yahoofinance', resolvedParams.operation, combinedInput);
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
          error: result.error || `${nodeType} ${resolvedParams.operation} operation failed`
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