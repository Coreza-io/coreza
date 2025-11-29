import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from '../types';
import { DataService } from '../../services/data';
import { MarketSource } from '../../types/marketEvent';
import { getRedis } from '../../config/redis';
import { REDIS_CHANNELS } from '../../config/redisChannels';
import { buildStoreKey, parseStoredValue } from '../../utils/store';

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
      const {
        symbols,
        stream_types,
        operation,
        credential_id,
        symbolSource = 'manual',
        sourceWorkflowId,
        sourceVariable,
      } = node.values;
      const { workflowId, userId, nodeId } = context;

      if (!workflowId || !userId || !nodeId) {
        return {
          success: false,
          error: 'Missing workflow context (workflowId, userId, or nodeId)'
        };
      }

      const redis = getRedis();
      let symbolArray: string[] = [];

      if (symbolSource === 'store') {
        if (!sourceWorkflowId || !sourceVariable) {
          return {
            success: false,
            error: 'Source workflow and variable are required when using stored symbols',
          };
        }

        const storeKey = buildStoreKey(userId, sourceWorkflowId, sourceVariable);
        const storedValue = parseStoredValue(await redis.get(storeKey));

        if (Array.isArray(storedValue)) {
          symbolArray = storedValue
            .map((symbol) => String(symbol).trim())
            .filter(Boolean);
        } else if (typeof storedValue === 'string') {
          symbolArray = storedValue
            .split(',')
            .map((symbol) => symbol.trim())
            .filter(Boolean);
        } else if (storedValue !== null && storedValue !== undefined) {
          const coerced = String(storedValue).trim();
          symbolArray = coerced ? [coerced] : [];
        }
      } else {
        symbolArray = typeof symbols === 'string'
          ? symbols.split(',').map(s => s.trim()).filter(Boolean)
          : Array.isArray(symbols) ? symbols : [];
      }

      if (symbolArray.length === 0) {
        return {
          success: false,
          error: 'No symbols provided for subscription'
        };
      }

      // Handle subscribe operation via Redis control channel
      if (operation === 'subscribe') {
        if (!credential_id) {
          return {
            success: false,
            error: 'No credential selected for subscription'
          };
        }

        // Publish control message to Redis
        // MarketControlHandler will orchestrate gateway connection and subscription
        const controlMessage = {
          action: 'subscribe',
          userId,
          workflowId,
          nodeId,
          symbols: symbolArray,
          source,
          credentialId: credential_id,
          eventTypes: stream_types,
        };

        await redis.publish(
          REDIS_CHANNELS.controlSubscribe,
          JSON.stringify(controlMessage)
        );

        console.log(`📤 [MarketExecutor] Published subscribe control message for ${source}:`, symbolArray);

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
      // Handle unsubscribe operation via Redis control channel
      else if (operation === 'unsubscribe') {
        // Publish control message to Redis
        const controlMessage = {
          action: 'unsubscribe',
          userId,
          workflowId,
          nodeId,
          symbols: symbolArray,
          source,
        };

        await redis.publish(
          REDIS_CHANNELS.controlUnsubscribe,
          JSON.stringify(controlMessage)
        );

        console.log(`📤 [MarketExecutor] Published unsubscribe control message for ${source}:`, symbolArray);

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