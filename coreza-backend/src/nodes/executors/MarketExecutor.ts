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
import { getDataSourceService } from "../../services/datasources";
import { MarketSource } from "../../types/marketEvent";
import { SubscriptionService } from "../../services/SubscriptionService";
import { normalizeStreamTypes } from "../../utils/streamHelpers";
import {
  createSuccessOutput,
  createErrorOutput,
  toNodeResult,
  NormalizeContext,
} from "../../utils/normalizeOutput";
import { getRedisCache } from "../../config/redis";
import {
  getAllowedSymbols,
  matchesTypeFilter,
  parseSymbolString,
  matchesSymbolFilter,
} from "../../utils/streamFilters";

export class MarketExecutor implements INodeExecutor {
  readonly category = "Market";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
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
      const source = node.subCategory;
      const data_type = node.values.data_type;
      const sourceId = `${source}_${data_type}`;
      const operation = node.values.operation;

      // Default: historical/REST market data
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      console.log(
        `🏪 Executing ${node.name} node with params:`,
        resolvedParams,
      );

      // Handle subscription nodes (ACTION nodes that manage subscriptions)
      if (operation === "subscribe") {
        const result = await SubscriptionService.execute({
          source: sourceId,
          userId: context?.userId,
          workflowId: context?.workflowId,
          nodeId: context?.nodeId,
          credentialId: node.values.credential_id,
          operation: resolvedParams.operation,
          symbols: resolvedParams.symbols,
          initialInput: context?.initialInput,
          streamTypes: normalizeStreamTypes(resolvedParams.stream_types, resolvedParams.include_order_updates),
          feed: resolvedParams.feed,
          environment: resolvedParams.environment,
          assetType: resolvedParams.asset_type,
          interval: resolvedParams.interval,
          depth_levels: resolvedParams.depth_levels,
          scope: resolvedParams.scope,
          targetWorkflowId: resolvedParams.targetWorkflowId,
        });

        if (!result.success) {
          return toNodeResult(
            createErrorOutput(
              result.error || "Subscription failed",
              normalizeCtx,
            ),
          );
        }
        return toNodeResult(createSuccessOutput(result.data, normalizeCtx));
      }

      // Handle streaming trigger nodes (pure data receivers)
      if (nodeName.includes("StreamData")) {
        return await this.handleStreamingTrigger(
          node,
          context,
          sourceId,
          normalizeCtx,
        );
      }

      const dataSourceService = getDataSourceService("yahoofinance");
      if (!dataSourceService) {
        const errOutput = createErrorOutput(
          "Yahoo Finance data source is not available",
          normalizeCtx,
        );
        return toNodeResult(errOutput);
      }

      const result = await dataSourceService.execute({
        user_id: context?.userId || "system",
        operation: resolvedParams.operation || "get_quote",
        ...resolvedParams,
      });

      if (!result.success) {
        const errOutput = createErrorOutput(
          result.error || "Market data fetch failed",
          normalizeCtx,
        );
        return toNodeResult(errOutput);
      }

      const successOutput = createSuccessOutput(result.data, normalizeCtx);
      return toNodeResult(successOutput);
    } catch (error) {
      const errOutput = createErrorOutput(
        `Market execution failed: ${error instanceof Error ? error.message : String(error)}`,
        normalizeCtx,
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
    normalizeCtx: NormalizeContext,
  ): Promise<NodeResult> {
    const {
      symbols,
      stream_types,
      operation,
      credential_id,
      feed,
      environment,
      asset_type,
      interval,
      depth_levels,
      scope,
      targetWorkflowId,
    } = node.values;
    const { workflowId, userId, nodeId, initialInput } = context;

    const result = await SubscriptionService.execute({
      source,
      userId,
      workflowId,
      nodeId,
      credentialId: credential_id,
      operation: operation,
      symbols,
      initialInput,
      streamTypes: normalizeStreamTypes(stream_types, node.values.include_order_updates),
      feed,
      environment,
      assetType: asset_type,
      interval,
      depth_levels,
      scope,
      targetWorkflowId,
    });

    // Normalize the subscription result
    if (!result.success) {
      const errOutput = createErrorOutput(
        result.error || "Subscription failed",
        normalizeCtx,
      );
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
    source: string,
  ): Promise<NodeResult> {
    const { initialInput, userId, workflowId } = context || {};
    const { filter_symbols, filter_types, mode, scope } = node.values || {};

    // When triggered by market data, initialInput contains the event
    if (initialInput?.marketEvent) {
      const event = initialInput.marketEvent;
      const eventSymbol = event.symbol?.toUpperCase();

      // Get allowed symbols based on mode and subscriptionMode using shared utility
      if (mode === "listen") {
        const redis = getRedisCache();

        // Parse filter_symbols string if provided
        const filterSymbolsList = parseSymbolString(filter_symbols);

        const allowedSymbols = await getAllowedSymbols(redis, {
          userId,
          workflowId,
          source,
          scope,
          filterSymbols:
            filterSymbolsList.length > 0 ? filterSymbolsList : undefined,
        });

        console.log(
          `🔍 [StreamTrigger] ${scope || "workflow"} mode - allowed symbols: ${allowedSymbols.join(", ")}`,
        );

        // Check if event symbol is in allowed list
        if (!matchesSymbolFilter(eventSymbol, allowedSymbols)) {
          console.log(
            `⏭️ [StreamTrigger] Symbol ${eventSymbol} not in allowed list, filtering out`,
          );
          const successOutput = createSuccessOutput(null, normalizeCtx);
          return toNodeResult(successOutput); // Filtered out
        }
      } else if (mode === "subscribe") {
        // Subscribe mode: only allow symbols defined in this node
        const allowed = parseSymbolString(filter_symbols);
        if (!matchesSymbolFilter(eventSymbol, allowed)) {
          const successOutput = createSuccessOutput(null, normalizeCtx);
          return toNodeResult(successOutput); // Filtered out
        }
      }

      // Apply optional event type filter using shared utility
      if (!matchesTypeFilter(event.type, filter_types || [])) {
        const successOutput = createSuccessOutput(null, normalizeCtx);
        return toNodeResult(successOutput); // Filtered out
      }

      const successOutput = createSuccessOutput(
        {
          symbol: event.symbol,
          type: event.type,
          [event.type]: event.data,
          timestamp: event.timestamp,
        },
        normalizeCtx,
      );
      return toNodeResult(successOutput);
    }

    // No market event - waiting state
    const successOutput = createSuccessOutput(
      {
        status: "waiting",
        message:
          "Waiting for market data. Ensure symbols are subscribed via AlpacaSubscribe/BinanceSubscribe node.",
      },
      normalizeCtx,
    );
    return toNodeResult(successOutput);
  }
}
