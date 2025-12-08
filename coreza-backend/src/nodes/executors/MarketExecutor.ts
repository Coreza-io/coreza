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
import { SubscriptionService } from '../../services/SubscriptionService';

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
   * Delegates to SubscriptionService for centralized logic
   */
  private async handleSubscriptionNode(
    node: WorkflowNode,
    context: any,
    source: MarketSource
  ): Promise<NodeResult> {
    const {
      symbols,
      stream_types,
      operation,
      credential_id,
      symbolSource,
      sourceWorkflowId,
      sourceVariable,
      feed,
      environment,
      asset_type,
      kline_interval,
    } = node.values;
    const { workflowId, userId, nodeId, initialInput } = context;

    const result = await SubscriptionService.execute({
      source,
      userId,
      workflowId,
      nodeId,
      credentialId: credential_id,
      operation: operation || 'subscribe',
      symbols,
      symbolSource,
      sourceWorkflowId,
      sourceVariable,
      initialInput,
      streamTypes: stream_types,
      feed,
      environment,
      assetType: asset_type,
      klineInterval: kline_interval,
    });

    return result;
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
