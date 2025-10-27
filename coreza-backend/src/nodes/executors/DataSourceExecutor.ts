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
        case 'GoogleWebSearch':
          result = await this.executeGoogleWebSearch(resolvedParams, context);
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

  private async executeGoogleWebSearch(params: any, context?: any): Promise<NodeResult> {
    try {
      const CredentialManager = (await import('../../utils/credentialManager')).default;
      const axios = (await import('axios')).default;

      const { user_id, credential_id, query, numResults = 10 } = params;

      if (!user_id) {
        return { success: false, error: 'user_id is required' };
      }

      if (!credential_id) {
        return { success: false, error: 'credential_id is required' };
      }

      if (!query) {
        return { success: false, error: 'query is required' };
      }

      // Get credentials
      const { credentials } = await CredentialManager.getCredentials(
        user_id,
        'googlesearch',
        credential_id
      );

      const { api_key, search_engine_id } = credentials.client_json;

      // Execute search
      const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(api_key)}&cx=${encodeURIComponent(search_engine_id)}&q=${encodeURIComponent(query)}&num=${numResults}`;
      
      const response = await axios.get(searchUrl);

      if (!response.data || !response.data.items) {
        return {
          success: true,
          data: {
            query,
            results: [],
            searchInformation: response.data.searchInformation || {}
          }
        };
      }

      // Format results
      const results = response.data.items.map((item: any) => ({
        title: item.title,
        link: item.link,
        snippet: item.snippet,
        displayLink: item.displayLink
      }));

      return {
        success: true,
        data: {
          query,
          results,
          searchInformation: response.data.searchInformation
        }
      };
    } catch (error: any) {
      console.error('Google Search execution error:', error);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message || 'Google Search execution failed'
      };
    }
  }
}