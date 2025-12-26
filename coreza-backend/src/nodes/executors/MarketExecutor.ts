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

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { DataService } from "../../services/data";
import { MarketSource } from "../../types/marketEvent";
import { SubscriptionService } from "../../services/SubscriptionService";
import { createSuccessOutput, createErrorOutput, toNodeResult, NormalizeContext } from "../../utils/normalizeOutput";
import { getRedisCache } from "../../config/redis";

export class MarketExecutor implements INodeExecutor {
  readonly category = "Market";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const startTime = Date.now();
    const normalizeCtx: NormalizeContext = {
      nodeId: node.id,
      nodeName: node.name,
      category: this.category,
      startTime,
    };

    try {
      const nodeName = node.name;

      // Handle subscription nodes (ACTION nodes that manage subscriptions)
      if (nodeName === "AlpacaSubscribe") {
        return this.handleSubscriptionNode(node, context, "alpaca", normalizeCtx);
      } else if (nodeName === "BinanceSubscribe") {
        return this.handleSubscriptionNode(node, context, "binance", normalizeCtx);
      }

      // Handle streaming trigger nodes (pure data receivers)
      if (nodeName === "AlpacaStreamData") {
        return await this.handleStreamingTrigger(node, context, normalizeCtx, "alpaca_stream");
      } else if (nodeName === "BinanceStreamData") {
        return await this.handleStreamingTrigger(node, context, normalizeCtx, "binance_stream");
      }

      // Default: historical/REST market data
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      console.log(
        `🏪 Executing ${node.name} node with params:`,
        resolvedParams
      );

      const result = await DataService.getMarketData(resolvedParams);

      if (!result.success) {
        const errOutput = createErrorOutput(result.error || "Market data fetch failed", normalizeCtx);
        return toNodeResult(errOutput);
      }

      const successOutput = createSuccessOutput(result.data, normalizeCtx);
      return toNodeResult(successOutput);
    } catch (error) {
      const errOutput = createErrorOutput(
        `Market execution failed: ${error instanceof Error ? error.message : String(error)}`,
        normalizeCtx
      );
      return toNodeResult(errOutput);
    }
  }

  /**
   * Handle subscription nodes (AlpacaSubscribe, BinanceSubscribe)
   * Delegates to SubscriptionService for centralized logic
   */
  private async handleSubscriptionNode(
    node: WorkflowNode,
    context: any,
    source: MarketSource,
    normalizeCtx: NormalizeContext
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
      subscriptionScope,
      targetWorkflowId,
    } = node.values;
    const { workflowId, userId, nodeId, initialInput } = context;

    const result = await SubscriptionService.execute({
      source,
      userId,
      workflowId,
      nodeId,
      credentialId: credential_id,
      operation: operation || "subscribe",
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
      subscriptionScope,
      targetWorkflowId,
    });

    // Normalize the subscription result
    if (!result.success) {
      const errOutput = createErrorOutput(result.error || "Subscription failed", normalizeCtx);
      return toNodeResult(errOutput);
    }

    const successOutput = createSuccessOutput(result.data, normalizeCtx);
    return toNodeResult(successOutput);
  }

  /**
   * Handle streaming trigger nodes (AlpacaStreamData, BinanceStreamData)
   * These are pure data receivers - they don't manage subscriptions
   * Now properly filters based on subscriptionMode (workflow vs global)
   */
  private async handleStreamingTrigger(
    node: WorkflowNode,
    context: any,
    normalizeCtx: NormalizeContext,
    source: string
  ): Promise<NodeResult> {
    const { initialInput, userId, workflowId } = context || {};
    const { filter_symbols, filter_types, mode, subscriptionMode } = node.values || {};

    // When triggered by market data, initialInput contains the event
    if (initialInput?.marketEvent) {
      const event = initialInput.marketEvent;
      const eventSymbol = event.symbol?.toUpperCase();

      // Get allowed symbols based on mode and subscriptionMode
      let allowedSymbols: string[] = [];
      
      if (mode === 'listen') {
        const redis = getRedisCache();
        
        if (subscriptionMode === 'global') {
          // Fetch user's globally subscribed symbols
          const globalSymbols = await redis.smembers(`user:${userId}:subscribed_symbols:${source}`);
          allowedSymbols = globalSymbols.map(s => s.toUpperCase());
          console.log(`🔍 [StreamTrigger] Global mode - allowed symbols: ${allowedSymbols.join(', ')}`);
        } else {
          // Default: workflow-scoped symbols
          const workflowSymbols = await redis.smembers(`workflow:${workflowId}:subscribed_symbols:${source}`);
          allowedSymbols = workflowSymbols.map(s => s.toUpperCase());
          console.log(`🔍 [StreamTrigger] Workflow mode - allowed symbols: ${allowedSymbols.join(', ')}`);
        }

        // Apply additional filter_symbols if specified
        if (filter_symbols) {
          const filterList = filter_symbols
            .split(",")
            .map((s: string) => s.trim().toUpperCase())
            .filter(Boolean);
          
          if (filterList.length > 0) {
            // Only allow symbols that are both in allowedSymbols AND filterList
            allowedSymbols = allowedSymbols.filter(s => filterList.includes(s));
            console.log(`🔍 [StreamTrigger] After filter_symbols: ${allowedSymbols.join(', ')}`);
          }
        }

        // Check if event symbol is in allowed list
        if (allowedSymbols.length > 0 && !allowedSymbols.includes(eventSymbol)) {
          console.log(`⏭️ [StreamTrigger] Symbol ${eventSymbol} not in allowed list, filtering out`);
          const successOutput = createSuccessOutput(null, normalizeCtx);
          return toNodeResult(successOutput); // Filtered out
        }
      } else if (mode === 'subscribe') {
        // Subscribe mode: only allow symbols defined in this node
        if (filter_symbols) {
          const allowed = filter_symbols
            .split(",")
            .map((s: string) => s.trim().toUpperCase());
          if (!allowed.includes(eventSymbol)) {
            const successOutput = createSuccessOutput(null, normalizeCtx);
            return toNodeResult(successOutput); // Filtered out
          }
        }
      }

      // Apply optional event type filter
      if (
        filter_types &&
        filter_types.length > 0 &&
        !filter_types.includes(event.type)
      ) {
        const successOutput = createSuccessOutput(null, normalizeCtx);
        return toNodeResult(successOutput); // Filtered out
      }

      const successOutput = createSuccessOutput({
        symbol: event.symbol,
        type: event.type,
        [event.type]: event.data,
        timestamp: event.timestamp,
      }, normalizeCtx);
      return toNodeResult(successOutput);
    }

    // No market event - waiting state
    const successOutput = createSuccessOutput({
      status: "waiting",
      message:
        "Waiting for market data. Ensure symbols are subscribed via AlpacaSubscribe/BinanceSubscribe node.",
    }, normalizeCtx);
    return toNodeResult(successOutput);
  }
}
