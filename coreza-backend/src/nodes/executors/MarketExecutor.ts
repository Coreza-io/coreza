import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from '../types';
import { DataService } from '../../services/data';
import { MarketDataGateway } from '../../services/MarketDataGateway';
import { MarketDataSubscriber } from '../../services/MarketDataSubscriber';
import { MarketSource } from '../../types/marketEvent';
import CredentialManager from '../../utils/credentialManager';

export class MarketExecutor implements INodeExecutor {
  readonly category = 'Market';

  async execute(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    try {
      const nodeType = node.node_type || node.type;

      // Handle streaming nodes (AlpacaStreamData, BinanceStreamData, etc.)
      if (nodeType === 'AlpacaStreamData') {
        return this.handleStreamingNode(node, context, 'alpaca');
      } else if (nodeType === 'BinanceStreamData') {
        return this.handleStreamingNode(node, context, 'binance');
      } else if (nodeType === 'DhanStreamData') {
        return this.handleStreamingNode(node, context, 'dhan');
      } else if (nodeType === 'SchwabStreamData') {
        return this.handleStreamingNode(node, context, 'schwab');
      }

      // Default: historical/REST market data
      const resolvedParams = context?.resolveNodeParameters ? 
        context.resolveNodeParameters(node, input) : 
        { ...node.values, ...input };

      console.log(`🏪 Executing ${node.name || node.node_type} node with params:`, resolvedParams);

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

  /**
   * Handle streaming market data nodes
   */
  private async handleStreamingNode(
    node: WorkflowNode,
    context: any,
    source: MarketSource
  ): Promise<NodeResult> {
    try {
      const { symbols, stream_types, operation, credential_id } = node.values;
      const { workflowId, userId, nodeId } = context;

      if (!workflowId || !userId || !nodeId) {
        return {
          success: false,
          error: 'Missing workflow context (workflowId, userId, or nodeId)'
        };
      }

      // Parse symbols (comma-separated string to array)
      const symbolArray = typeof symbols === 'string' 
        ? symbols.split(',').map(s => s.trim()).filter(Boolean)
        : Array.isArray(symbols) ? symbols : [];

      if (symbolArray.length === 0) {
        return {
          success: false,
          error: 'No symbols provided for subscription'
        };
      }

      // Handle subscribe operation
      if (operation === 'subscribe') {
        // Get credentials
        if (!credential_id) {
          return {
            success: false,
            error: 'No credential selected for subscription'
          };
        }

        const { credentials, error: credError } = await CredentialManager.getDecryptedCredentials(
          userId,
          source,
          credential_id
        );

        if (credError || !credentials) {
          return {
            success: false,
            error: `Failed to get credentials: ${credError}`
          };
        }

        // Connect gateway and subscribe to broker
        const gateway = MarketDataGateway.getInstance(source);
        await gateway.connect(credentials);
        gateway.subscribeSymbols(symbolArray);

        // Subscribe workflow to Redis market data
        const subscriber = MarketDataSubscriber.getInstance();
        await subscriber.subscribe(workflowId, nodeId, userId, symbolArray, {
          source,
          eventTypes: stream_types,
        });

        return {
          success: true,
          data: {
            status: 'subscribed',
            source,
            symbols: symbolArray,
            stream_types,
          }
        };
      } 
      // Handle unsubscribe operation
      else if (operation === 'unsubscribe') {
        // Unsubscribe from gateway
        const gateway = MarketDataGateway.getInstance(source);
        gateway.unsubscribeSymbols(symbolArray);

        // Unsubscribe workflow from Redis
        const subscriber = MarketDataSubscriber.getInstance();
        await subscriber.unsubscribe(workflowId);

        return {
          success: true,
          data: {
            status: 'unsubscribed',
            source,
            symbols: symbolArray,
          }
        };
      }

      return {
        success: false,
        error: `Unknown operation: ${operation}`
      };
    } catch (error) {
      return {
        success: false,
        error: `Streaming node error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}