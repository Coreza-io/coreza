/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { getRedisCache } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import { lookupSecurityId } from "../brokers/dhan/scripMaster";
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
  streamType?: string[];
  exchange?: string;
  // Alpaca-specific
  feed?: string;
  // Binance-specific
  environment?: string;
  assetType?: string;
  marketType?: string;
  contractType?: "perpetual" | "current_quarter" | "next_quarter";
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
    streamType?: string[];
    message: string;
  };
  error?: string;
}

/** Default timeout for waiting on subscription readiness (ms) */
const SUBSCRIPTION_READY_TIMEOUT_MS = parseInt(
  process.env.SUBSCRIPTION_READY_TIMEOUT_MS || "60000",
  10,
);
/** Polling interval when checking subscription readiness (ms) */
const SUBSCRIPTION_READY_POLL_MS = parseInt(
  process.env.SUBSCRIPTION_READY_POLL_MS || "250",
  10,
);
const DEFAULT_DHAN_EXCHANGE_SEGMENT = "NSE_EQ";

/**
 * Centralized service for managing market data subscriptions.
 * Used by both MarketExecutor (backend workflow execution) and
 * websocket.ts routes (frontend manual runs).
 */
export class SubscriptionService {
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
        streamType,
        exchange,
        feed,
        environment,
        assetType,
        marketType,
        contractType,
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
      let symbolArray = normalizeSymbols(symbols);

      // For unsubscribe, allow empty symbols if workflowId is provided (workflow cleanup)
      if (symbolArray.length === 0 && operation === "subscribe") {
        return {
          success: false,
          error: "No symbols provided for subscription",
        };
      }

      const baseBroker = String(source).split("_")[0];
      const isCompanionSource =
        String(source).endsWith("_trading") || String(source).endsWith("_news");

      if (baseBroker === "dhan" && !isCompanionSource) {
        const exchangeSegment = exchange || DEFAULT_DHAN_EXCHANGE_SEGMENT;
        const resolvedSymbols: string[] = [];

        for (const symbol of symbolArray) {
          if (symbol === "*" || /^\d+$/.test(symbol)) {
            resolvedSymbols.push(symbol);
            continue;
          }

          const securityId = await lookupSecurityId(symbol, exchangeSegment);
          if (!securityId) {
            return {
              success: false,
              error: `Security ID not found for symbol="${symbol}" segment="${exchangeSegment}"`,
            };
          }

          resolvedSymbols.push(securityId);
        }

        symbolArray = resolvedSymbols;
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
        streamType: streamType || [], // RAW event types (kline, trade, etc.)
        assetType,
        marketType,
        scope,
        // Pass raw parameters for stream name building in market-stream-service
        interval,
        depthLevels: depth_levels,
        contractType,
      };

      // Add target workflow ID for workflow-scoped subscriptions
      if (scope === "workflow" && resolvedTargetWorkflowId) {
        controlMessage.targetWorkflowId = resolvedTargetWorkflowId;
      }

      // Add source-specific fields
      if (feed) controlMessage.feed = feed;
      if (environment) controlMessage.environment = environment;
      if (assetType) controlMessage.assetType = assetType;
      if (marketType) controlMessage.marketType = marketType;

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
          streamType: streamType || [],
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

  /**
   * Wait until the subscription streams key in Redis contains at least one entry.
   * This prevents the subscribe→register race condition where register_workflow
   * runs before the MarketControlHandler has materialized the subscription.
   *
   * @param userId  - user who owns the subscription
   * @param source  - sourceId (e.g. "alpaca_crypto", "binance_stream")
   * @param scope   - "workflow" or "global"
   * @param workflowId - required when scope === "workflow"
   * @param timeoutMs  - max wait (default SUBSCRIPTION_READY_TIMEOUT_MS)
   * @returns true if ready, false if timed out
   */
  static async waitForSubscriptionReady(params: {
    userId: string;
    source: string;
    environment: string;
    scope: string;
    workflowId?: string;
    timeoutMs?: number;
  }): Promise<boolean> {
    const { userId, source, environment, scope, workflowId } = params;
    const timeoutMs = params.timeoutMs ?? SUBSCRIPTION_READY_TIMEOUT_MS;
    const redis = getRedisCache();

    // Determine which Redis key to poll
    const streamsKey =
      scope === "workflow" && workflowId
        ? REDIS_CHANNELS.workflowSubscriptionStreams(
            userId,
            workflowId,
            source,
            environment,
          )
        : REDIS_CHANNELS.globalSubscriptionStreams(userId, source, environment);

    const startTime = Date.now();
    let attempt = 0;

    while (Date.now() - startTime < timeoutMs) {
      attempt++;
      const count = await redis.scard(streamsKey);
      if (count > 0) {
        console.log(
          `✅ [SubscriptionService] Subscription ready at ${streamsKey} (${count} streams, ${attempt} polls, ${Date.now() - startTime}ms)`,
        );
        return true;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, SUBSCRIPTION_READY_POLL_MS),
      );
    }

    console.warn(
      `⚠️ [SubscriptionService] Subscription readiness timed out after ${timeoutMs}ms for ${streamsKey}`,
    );
    return false;
  }
}
