/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from '../types';
import { DataService } from '../../services/data';
import { MarketSource } from '../../types/marketEvent';
import { getRedis } from '../../config/redis';
import { REDIS_CHANNELS } from '../../config/redisChannels';
import { buildStoreKey, getStoreValue } from '../../utils/store';

export class MarketExecutor implements INodeExecutor {
  readonly category = 'Market';

  async execute(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    try {
      const nodeName = node.name;

      // Handle subscription nodes (ACTION nodes that manage subscriptions)
      if (nodeName === 'AlpacaSubscribe') {
        return this.handleSubscriptionNode(node, context, 'alpaca');
      } else if (nodeName === 'BinanceSubscribe') {
        return this.handleSubscriptionNode(node, context, 'binance');
      }

      // Handle streaming trigger nodes (pure data receivers)
      if (nodeName === 'AlpacaStreamData') {
        return this.handleStreamingTrigger(node, context);
      } else if (nodeName === 'BinanceStreamData') {
        return this.handleStreamingTrigger(node, context);
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
   * Handle subscription nodes (AlpacaSubscribe, BinanceSubscribe)
   * These are ACTION nodes that manage subscriptions for the user
   */
  private async handleSubscriptionNode(
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
        feed,
        environment,
        asset_type,
        kline_interval,
      } = node.values;
      const { workflowId, userId, nodeId, initialInput } = context;

      if (!userId) {
        return {
          success: false,
          error: 'Missing userId in context'
        };
      }

      const redis = getRedis();
      let symbolArray: string[] = [];

      // Resolve symbols based on source
      if (symbolSource === 'store') {
        if (!sourceWorkflowId || !sourceVariable) {
          return {
            success: false,
            error: 'Source workflow and variable are required when using stored symbols',
          };
        }

        const storeKey = buildStoreKey(userId, sourceWorkflowId, sourceVariable);
        const storedValue = await getStoreValue(redis, storeKey);

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
      } else if (symbolSource === 'input' && initialInput?.symbols) {
        // Symbols from workflow input
        symbolArray = Array.isArray(initialInput.symbols) 
          ? initialInput.symbols 
          : String(initialInput.symbols).split(',').map((s: string) => s.trim()).filter(Boolean);
      } else {
        // Manual entry
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

      // Process event types - for Binance, combine kline with interval
      let eventTypes = stream_types || ['trade'];
      if (source === 'binance' && eventTypes.includes('kline')) {
        const interval = kline_interval || '1m';
        eventTypes = eventTypes.map((t: string) => t === 'kline' ? `kline_${interval}` : t);
      }

      // Build control message
      const controlMessage: Record<string, any> = {
        action: operation,
        userId,
        workflowId,
        nodeId,
        symbols: symbolArray,
        source: `${source}_stream`,
        credentialId: credential_id,
        eventTypes,
      };

      // Add source-specific fields
      if (source === 'alpaca' && feed) {
        controlMessage.feed = feed;
      }
      if (source === 'binance') {
        if (environment) controlMessage.environment = environment;
        if (asset_type) controlMessage.assetType = asset_type;
      }

      // Publish to appropriate control channel
      const channel = operation === 'subscribe' 
        ? REDIS_CHANNELS.controlSubscribe 
        : REDIS_CHANNELS.controlUnsubscribe;

      await redis.publish(channel, JSON.stringify(controlMessage));

      console.log(`📤 [MarketExecutor] Published ${operation} control message for ${source}:`, symbolArray);

      return {
        success: true,
        data: {
          status: operation === 'subscribe' ? 'subscribed' : 'unsubscribed',
          source,
          symbols: symbolArray,
          stream_types,
          message: `Successfully ${operation}d to ${symbolArray.length} symbol(s)`
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `Subscription error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Handle streaming trigger nodes (AlpacaStreamData, BinanceStreamData)
   * These are pure data receivers - they don't manage subscriptions
   */
  private handleStreamingTrigger(
    node: WorkflowNode,
    context: any
  ): NodeResult {
    const { initialInput } = context || {};
    const { filter_symbols, filter_types } = node.values || {};

    // When triggered by market data, initialInput contains the event
    if (initialInput?.marketEvent) {
      const event = initialInput.marketEvent;
      
      // Apply optional symbol filter
      if (filter_symbols) {
        const allowed = filter_symbols.split(',').map((s: string) => s.trim().toUpperCase());
        if (!allowed.includes(event.symbol?.toUpperCase())) {
          return { success: true, data: null };  // Filtered out
        }
      }
      
      // Apply optional event type filter
      if (filter_types && filter_types.length > 0 && !filter_types.includes(event.type)) {
        return { success: true, data: null };  // Filtered out
      }

      return {
        success: true,
        data: {
          symbol: event.symbol,
          type: event.type,
          [event.type]: event.data,
          timestamp: event.timestamp,
        }
      };
    }

    // No market event - waiting state
    return {
      success: true,
      data: { 
        status: 'waiting', 
        message: 'Waiting for market data. Ensure symbols are subscribed via AlpacaSubscribe/BinanceSubscribe node.' 
      }
    };
  }
}
