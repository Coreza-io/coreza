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

import { getRedisCache } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import { MarketSource } from "../types/marketEvent";

export interface SubscriptionParams {
  source: MarketSource;
  userId: string;
  workflowId?: string;
  nodeId?: string;
  credentialId: string;
  operation: "subscribe" | "unsubscribe";
  // Symbol sources
  symbols?: string | string[];
  initialInput?: { symbols?: string | string[] };
  // Stream configuration
  streamTypes?: string[];
  // Data type (market, news, etc.) - used to build sourceId as {subCategory}_{dataType}
  dataType?: "market" | "news";
  // Alpaca-specific
  feed?: string;
  // Binance-specific
  environment?: string;
  assetType?: string;
  interval?: string;
  depth_levels?: string;
  // Subscription scope
  scope?: "global" | "workflow";
  targetWorkflowId?: string;
}

export interface SubscriptionResult {
  success: boolean;
  data?: {
    status: string;
    source: string;
    symbols: string[];
    streamTypes?: string[];
    message: string;
  };
  error?: string;
}

/**
 * Centralized service for managing market data subscriptions.
 * Used by both MarketExecutor (backend workflow execution) and
 * websocket.ts routes (frontend manual runs).
 */
export class SubscriptionService {
  /**
   * Resolve symbols from various sources (manual, store, input)
   */
  private static async resolveSymbols(
    params: SubscriptionParams,
  ): Promise<string[]> {
    const {
      symbols,
      symbolSource = "manual",
      sourceWorkflowId,
      sourceVariable,
      userId,
      initialInput,
    } = params;

    if (symbolSource === "input" && initialInput?.symbols) {
      return Array.isArray(initialInput.symbols)
        ? initialInput.symbols
        : String(initialInput.symbols)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    }

    // Manual entry
    if (!symbols) return [];

    return typeof symbols === "string"
      ? symbols
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : Array.isArray(symbols)
        ? symbols
        : [];
  }

  /**
   * Subscribe or unsubscribe from market data
   *
   * IMPORTANT: Subscribe nodes ONLY manage gateway subscriptions.
   * They do NOT register for data delivery - that's handled by StreamData trigger nodes.
   * workflowId/nodeId are intentionally NOT sent to avoid routing data to Subscribe nodes.
   */
  static async execute(
    params: SubscriptionParams,
  ): Promise<SubscriptionResult> {
    try {
      const {
        source,
        userId,
        workflowId,
        credentialId,
        operation,
        symbols,
        streamTypes,
        feed,
        environment,
        assetType,
        interval,
        depth_levels,
        scope,
        targetWorkflowId,
      } = params;

      // Resolve __current__ placeholder to actual workflowId from context
      let resolvedTargetWorkflowId = targetWorkflowId;
      if (targetWorkflowId === "__current__" && workflowId) {
        resolvedTargetWorkflowId = workflowId;
        console.log(
          `📝 [SubscriptionService] Resolved __current__ to workflowId: ${workflowId}`,
        );
      }

      if (!userId) {
        return { success: false, error: "Missing userId" };
      }

      if (operation === "subscribe" && !credentialId) {
        return {
          success: false,
          error: "Missing credentialId for subscription",
        };
      }

      function safeJsonParse(value: unknown): unknown {
        if (typeof value !== "string") return value;

        const trimmed = value.trim();
        if (!trimmed) return value;

        try {
          return JSON.parse(trimmed);
        } catch {
          return value;
        }
      }

      function normalizeSymbols(input: unknown): string[] {
        const parsed = safeJsonParse(input);

        if (Array.isArray(parsed)) {
          return parsed
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean);
        }

        if (typeof parsed === "string") {
          return parsed
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean);
        }

        return [];
      }
      const symbolArray = normalizeSymbols(symbols);
      // Resolve symbols
      // const symbolArray =
      //   typeof symbols === "string"
      //     ? symbols
      //         .split(",")
      //         .map((s) => s.trim().toUpperCase())
      //         .filter(Boolean)
      //     : Array.isArray(symbols)
      //       ? symbols.map((s) => s.trim().toUpperCase())
      //       : [];

      // For unsubscribe, allow empty symbols if workflowId is provided (workflow cleanup)
      if (symbolArray.length === 0 && operation === "subscribe") {
        return {
          success: false,
          error: "No symbols provided for subscription",
        };
      }

      // Build control message with RAW data
      // Stream name building is handled by market-stream-service (single source of truth)
      // NOTE: workflowId is included for tracking which workflow subscribed which symbols
      // This allows proper cleanup when the workflow is deactivated
      // nodeId is NOT included - Subscribe nodes don't receive data routing (that's handled by StreamData nodes)
      const controlMessage: Record<string, unknown> = {
        action: operation,
        userId,
        workflowId, // Included for workflow-scoped symbol tracking and cleanup
        symbols: symbolArray,
        source,
        credentialId,
        eventTypes: streamTypes || [], // RAW event types (kline, trade, etc.)
        scope,
        // Pass raw parameters for stream name building in market-stream-service
        interval,
        depthLevels: depth_levels,
      };

      // Add target workflow ID for workflow-scoped subscriptions
      if (scope === "workflow" && resolvedTargetWorkflowId) {
        controlMessage.targetWorkflowId = resolvedTargetWorkflowId;
      }

      // Add source-specific fields
      if (feed) controlMessage.feed = feed;
      if (environment) controlMessage.environment = environment;
      if (assetType) controlMessage.assetType = assetType;

      // Publish to appropriate control channel
      // NOTE: Stream name building and Redis storage is handled by MarketControlHandler
      const redis = getRedisCache();
      const channel =
        operation === "subscribe"
          ? REDIS_CHANNELS.controlSubscribe
          : REDIS_CHANNELS.controlUnsubscribe;

      await redis.publish(channel, JSON.stringify(controlMessage));

      console.log(
        `📤 [SubscriptionService] Published ${operation} control message for ${source}:`,
        symbolArray,
      );

      return {
        success: true,
        data: {
          status: operation === "subscribe" ? "subscribed" : "unsubscribed",
          source,
          symbols: symbolArray,
          streamTypes: streamTypes || [],
          message: `Successfully ${operation}d to ${symbolArray.length} symbol(s)`,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Subscription error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  /**
   * Convenience method for subscribe
   */
  static async subscribe(
    params: Omit<SubscriptionParams, "operation">,
  ): Promise<SubscriptionResult> {
    return this.execute({ ...params, operation: "subscribe" });
  }

  /**
   * Convenience method for unsubscribe
   */
  static async unsubscribe(
    params: Omit<SubscriptionParams, "operation" | "credentialId"> & {
      credentialId?: string;
    },
  ): Promise<SubscriptionResult> {
    return this.execute({
      ...params,
      operation: "unsubscribe",
      credentialId: params.credentialId || "",
    });
  }
}
