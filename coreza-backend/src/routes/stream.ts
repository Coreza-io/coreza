/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import express from "express";
import { requireAuth } from "../middleware/jwtAuth";
import { SubscriptionService } from "../services/SubscriptionService";
import { RegistrationService } from "../services/RegistrationService";
import { StatusService } from "../services/StatusService";
import { MAX_LISTENERS_PER_USER } from "../config/streaming";
import { supabase } from "../config/supabase";
import { bullMqJobQueue } from "../infra/jobQueue/jobQueueManager";
import { getRedisCache } from "../config/redis";
import { RedisKeys } from "../infra/redisKeys";
import {
  StreamExecutionRequest,
  StreamExecutionResponse,
} from "../types/streaming";
import {
  buildCryptoSymbols,
  normalizeSymbolList,
} from "../utils/symbolHelpers";
import { resolveStreamSourceId } from "./helpers/streamSource";

const router = express.Router();

// Apply JWT auth to all routes
router.use(requireAuth);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ORDER_UPDATE_MARKERS = new Set([
  "trade_updates",
  "ORDER_TRADE_UPDATE",
  "ALGO_UPDATE",
  "executionReport",
  "account_activity",
  "order_alert",
]);

const NEWS_MARKERS = new Set(["news"]);

function normalizeStreamTypeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((streamType) => String(streamType).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((streamType) => streamType.trim())
      .filter(Boolean);
  }
  return [];
}

function getTradingCompanionSource(source: string): string {
  return `${String(source || "").split("_")[0]}_trading`;
}

/**
 * Replay paused stream events from Redis stream cursor.
 * POST /stream/replay
 */
router.post("/replay", async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      workflowId,
      nodeId,
      afterEntryId,
      mode = "continue",
    } = req.body as {
      workflowId?: string;
      nodeId?: string;
      afterEntryId?: string;
      mode?: "continue" | "next" | "prev";
    };

    if (!workflowId || !nodeId || !afterEntryId) {
      return res.status(400).json({
        error: "workflowId, nodeId, and afterEntryId are required",
      });
    }

    if (!["continue", "next", "prev"].includes(mode)) {
      return res.status(400).json({
        error: "Invalid mode. Expected one of: continue, next, prev",
      });
    }

    if (!["continue", "next", "prev"].includes(mode)) {
      return res.status(400).json({
        error: "Invalid mode. Expected one of: continue, next, prev",
      });
    }

    if (!["continue", "next", "prev"].includes(mode)) {
      return res.status(400).json({
        error: "Invalid mode. Expected one of: continue, next, prev",
      });
    }

    if (!["continue", "next", "prev"].includes(mode)) {
      return res.status(400).json({
        error: "Invalid mode. Expected one of: continue, next, prev",
      });
    }

    const streamKey = RedisKeys.strategyStream(userId, workflowId);
    const redis = getRedisCache();

    let events: Array<[string, string[]]> = [];

    /**
     * continue:
     * XREAD naturally returns entries AFTER afterEntryId.
     *
     * next:
     * XRANGE is inclusive, so it may return afterEntryId itself.
     * Fetch 2 and skip afterEntryId manually.
     *
     * prev:
     * XREVRANGE is also inclusive, so it may return afterEntryId itself.
     * Fetch 2 and skip afterEntryId manually.
     */
    if (mode === "continue") {
      const result = await redis.xread(
        "COUNT",
        1000,
        "STREAMS",
        streamKey,
        afterEntryId,
      );

      events = result?.[0]?.[1] ?? [];
    } else if (mode === "next") {
      const rawEvents = await redis.xrange(
        streamKey,
        afterEntryId,
        "+",
        "COUNT",
        2,
      );

      const nextEvent = rawEvents.find(([entryId]) => entryId !== afterEntryId);

      events = nextEvent ? [nextEvent] : [];
    } else {
      const rawEvents = await redis.xrevrange(
        streamKey,
        afterEntryId,
        "-",
        "COUNT",
        2,
      );

      const previousEvent = rawEvents.find(
        ([entryId]) => entryId !== afterEntryId,
      );

      events = previousEvent ? [previousEvent] : [];
    }

    let replayed = 0;
    let lastEntryId: string | null = afterEntryId;

    for (const [entryId, fields] of events) {
      const eventIndex = fields.findIndex((field) => field === "event");

      if (eventIndex < 0 || eventIndex + 1 >= fields.length) {
        continue;
      }

      try {
        const rawEvent = fields[eventIndex + 1];
        const payload = JSON.parse(rawEvent);

        const enriched = {
          ...payload,
          data: {
            ...(payload?.data ?? {}),
            _entryId: entryId,
            _replay: true,
          },
        };

        await redis.publish(
          `ws:user:${userId}`,
          JSON.stringify({
            type: "market_data",
            payload: {
              workflowId,
              nodeId,
              source: payload?.source,
              data: enriched.data,
            },
          }),
        );

        replayed += 1;
        lastEntryId = entryId;

        // Only batch replay should be delayed.
        // Single-step next/prev should be instant.
        if (mode === "continue") {
          await sleep(5000);
        }
      } catch (error) {
        console.error("Failed to replay stream event:", {
          error,
          userId,
          workflowId,
          entryId,
        });
      }
    }

    if (mode === "continue") {
      return res.json({
        replayed,
        lastEntryId,
        mode,
      });
    }

    /**
     * For step modes, check whether another neighbor exists
     * after the new cursor.
     *
     * We again avoid exclusive Redis IDs.
     * So we fetch 2 and skip the current lastEntryId manually.
     */
    let hasMore = false;

    if (lastEntryId) {
      if (mode === "next") {
        const rawNextEvents = await redis.xrange(
          streamKey,
          lastEntryId,
          "+",
          "COUNT",
          2,
        );

        const nextEvent = rawNextEvents.find(
          ([entryId]) => entryId !== lastEntryId,
        );

        hasMore = Boolean(nextEvent);
      } else {
        const rawPreviousEvents = await redis.xrevrange(
          streamKey,
          lastEntryId,
          "-",
          "COUNT",
          2,
        );

        const previousEvent = rawPreviousEvents.find(
          ([entryId]) => entryId !== lastEntryId,
        );

        hasMore = Boolean(previousEvent);
      }
    }

    return res.json({
      replayed,
      lastEntryId,
      mode,
      hasNext: mode === "next" ? hasMore : undefined,
      hasPrevious: mode === "prev" ? hasMore : undefined,
    });
  } catch (error) {
    console.error("Replay stream error:", error);

    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to replay stream",
    });
  }
});

// ============================================
// MARKET DATA SUBSCRIPTION STATUS
// ============================================

/**
 * Get all active market data subscriptions and their status
 * GET /stream/subscriptions/status
 */
router.get("/subscriptions/status", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const status = await StatusService.getSubscriptionStatus(userId);

    res.json(status);
  } catch (error) {
    console.error("Error fetching subscription status:", error);
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to fetch subscription status",
    });
  }
});

// ============================================
// MARKET DATA SUBSCRIPTION OPERATIONS
// ============================================

/**
 * Subscribe to a market data source via Redis Pub/Sub
 * POST /stream/:source/subscribe
 */
router.post("/:source/subscribe", async (req, res) => {
  try {
    const userId = req.user?.id;
    const source = req.params.source;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      credential_id,
      symbols,
      node_id,
      category,
      workflowId,
      assetType,
      stream_type,
      stream_types,
      exchange,
      crypto_base,
      crypto_quote,
      feed,
      environment,
      marketType,
      contractType,
      interval,
      depth_levels,
      scope,
      targetWorkflowId,
      account_id,
      accountHash,
    } = req.body;

    if (!credential_id)
      return res.status(400).json({ error: "credential_id is required" });

    if (!node_id) return res.status(400).json({ error: "node_id is required" });

    const sourceId = resolveStreamSourceId(source, category, assetType);

    // Dhan nodes historically send `stream_types`; most broker nodes send `stream_type`.
    const streamType = normalizeStreamTypeList(stream_type ?? stream_types);

    const hasOrderUpdate = streamType.some((streamName) =>
      ORDER_UPDATE_MARKERS.has(streamName),
    );
    const hasNews = streamType.some((streamName) =>
      NEWS_MARKERS.has(streamName),
    );
    const { marketstreamType, tradingstreamType, newsStreamType } =
      streamType.reduce(
        (acc, t: string) => {
          if (ORDER_UPDATE_MARKERS.has(t)) {
            acc.tradingstreamType.push(t);
          } else if (NEWS_MARKERS.has(t)) {
            acc.newsStreamType.push(t);
          } else {
            acc.marketstreamType.push(t);
          }
          return acc;
        },
        {
          marketstreamType: [] as string[],
          tradingstreamType: [] as string[],
          newsStreamType: [] as string[],
        },
      );

    const normalizedSymbols = buildCryptoSymbols(
      stream_type,
      crypto_base,
      crypto_quote,
    );
    const resolvedSymbols =
      normalizedSymbols.length > 0 ? normalizedSymbols : symbols;
    // const parsedMarketSymbols = normalizeSymbolList(resolvedSymbols);
    // if (marketstreamType.length > 0 && parsedMarketSymbols.length === 0) {
    //   return res.status(400).json({
    //     error: "At least one symbol is required for market streams",
    //   });
    // }
    // if (tradingstreamType.includes("account_activity") && !account_id && !accountHash) {
    //   return res.status(400).json({ error: "account_id is required for account_activity" });
    // }

    if (hasOrderUpdate) {
      const tradingSourceId = getTradingCompanionSource(source);
      await SubscriptionService.subscribe({
        source: tradingSourceId as any,
        userId,
        workflowId: workflowId,
        nodeId: node_id,
        credentialId: credential_id,
        symbols: ["*"],
        streamType: tradingstreamType,
        environment,
        assetType: assetType,
        marketType: marketType,
        contractType,
        scope,
        targetWorkflowId,
      });
    }
    if (hasNews) {
      const newsSourceId = `${source}_news`;
      await SubscriptionService.subscribe({
        source: newsSourceId as any,
        userId,
        workflowId: workflowId,
        nodeId: node_id,
        credentialId: credential_id,
        symbols: resolvedSymbols,
        streamType: newsStreamType.length > 0 ? newsStreamType : ["news"],
        environment,
        assetType: assetType,
        marketType: marketType,
        contractType,
        scope,
        targetWorkflowId,
      });
    }

    // Subscribe to market/crypto streams (excluding trading/news streams)

    let result;
    if (marketstreamType.length > 0 || !hasOrderUpdate) {
      result = await SubscriptionService.subscribe({
        source: sourceId,
        userId,
        workflowId: workflowId,
        nodeId: node_id,
        credentialId: credential_id,
        symbols: resolvedSymbols,
        streamType: marketstreamType.length > 0 ? marketstreamType : undefined,
        exchange,
        feed,
        environment,
        assetType: assetType,
        marketType: marketType,
        contractType,
        interval,
        depth_levels: depth_levels,
        scope,
        targetWorkflowId,
      });
    } else {
      result = {
        success: true,
        data: {
          message: "Subscribed to order updates",
          symbols: resolvedSymbols,
          streamType: tradingstreamType,
        },
      };
    }

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      message: result.data?.message,
      symbols: result.data?.symbols,
      stream_type: result.data?.streamType,
      sourceId,
      node_id,
      workflowId: workflowId || null,
    });
  } catch (error) {
    console.error("Subscribe error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Subscription failed",
    });
  }
});

/**
 * Unsubscribe from a market data source via Redis Pub/Sub
 * POST /stream/:source/unsubscribe
 */
router.post("/:source/unsubscribe", async (req, res) => {
  try {
    const userId = req.user?.id;
    const source = req.params.source;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      credential_id,
      symbols,
      node_id,
      category,
      workflowId,
      assetType,
      marketType,
      stream_type,
      stream_types,
      exchange,
      crypto_base,
      crypto_quote,
      feed,
      environment,
      contractType,
      interval,
      depth_levels,
      scope,
      targetWorkflowId,
      account_id,
      accountHash,
    } = req.body;

    const sourceId = resolveStreamSourceId(source, category, assetType);

    if (!sourceId) {
      return res.status(400).json({ error: `Unknown source: ${sourceId}` });
    }

    // Dhan nodes historically send `stream_types`; most broker nodes send `stream_type`.
    const streamTypes = normalizeStreamTypeList(stream_type ?? stream_types);

    // If order_update is included, also unsubscribe from trading source
    const ORDER_UPDATE_MARKERS = new Set([
      "trade_updates",
      "ORDER_TRADE_UPDATE",
      "ALGO_UPDATE",
      "executionReport",
      "account_activity",
      "order_alert",
    ]);
    // Split trading lifecycle marker from market stream types
    const hasOrderUpdate = streamTypes.some((streamName) =>
      ORDER_UPDATE_MARKERS.has(streamName),
    );
    const hasNews = streamTypes.some((streamName) =>
      NEWS_MARKERS.has(streamName),
    );
    const { marketstreamType, tradingstreamType, newsStreamType } =
      streamTypes.reduce(
        (acc, t: string) => {
          if (ORDER_UPDATE_MARKERS.has(t)) {
            acc.tradingstreamType.push(t);
          } else if (NEWS_MARKERS.has(t)) {
            acc.newsStreamType.push(t);
          } else {
            acc.marketstreamType.push(t);
          }
          return acc;
        },
        {
          marketstreamType: [] as string[],
          tradingstreamType: [] as string[],
          newsStreamType: [] as string[],
        },
      );
    const normalizedSymbols = buildCryptoSymbols(
      stream_type,
      crypto_base,
      crypto_quote,
    );
    const resolvedSymbols =
      normalizedSymbols.length > 0 ? normalizedSymbols : symbols;

    if (hasOrderUpdate) {
      const tradingSourceId = getTradingCompanionSource(source);
      await SubscriptionService.unsubscribe({
        source: tradingSourceId as any,
        userId,
        workflowId: workflowId,
        credentialId: credential_id,
        symbols: ["*"],
        streamType: tradingstreamType,
        scope,
        environment,
        targetWorkflowId,
      });
    }

    if (hasNews) {
      await SubscriptionService.unsubscribe({
        source: `${source}_news` as any,
        userId,
        workflowId: workflowId,
        credentialId: credential_id,
        symbols: resolvedSymbols,
        streamType: newsStreamType.length > 0 ? newsStreamType : ["news"],
        scope,
        environment,
        targetWorkflowId,
      });
    }
    let result: any;
    if (marketstreamType) {
      result = await SubscriptionService.unsubscribe({
        source: sourceId,
        userId,
        workflowId: workflowId,
        nodeId: node_id,
        credentialId: credential_id,
        symbols: resolvedSymbols,
        streamType: marketstreamType.length > 0 ? marketstreamType : undefined,
        exchange,
        feed,
        environment,
        assetType: assetType,
        marketType: marketType,
        contractType,
        interval,
        depth_levels: depth_levels,
        scope,
        targetWorkflowId,
      });
    }

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      message: result.data?.message,
      sourceId,
      symbols: result.data?.symbols,
      stream_type: result.data?.streamType,
      targetWorkflowId: targetWorkflowId || null,
    });
  } catch (error) {
    console.error("Unsubscribe error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unsubscribe failed",
    });
  }
});

/**
 * Update activity timestamp for a streaming workflow
 * POST /stream/streaming-activity
 *
 * Called periodically to indicate a streaming workflow is still active.
 * Prevents the cleanup service from removing it.
 */
router.post("/streaming-activity", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflowId, node_id } = req.body;

    if (!workflowId || !node_id) {
      return res
        .status(400)
        .json({ error: "workflowId and node_id are required" });
    }

    const success = await RegistrationService.updateActivity(
      userId,
      workflowId,
    );

    if (!success) {
      return res.status(404).json({ error: "Registration not found" });
    }

    res.json({
      success: true,
      message: "Registration activity updated",
      lastActivityAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error updating streaming activity:", error);
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update activity",
    });
  }
});

/**
 * Manually trigger cleanup of stale streaming workflows
 * POST /stream/cleanup-streaming
 *
 * Admin endpoint to force cleanup of stale subscriptions.
 */
router.post("/cleanup-streaming", async (req, res) => {
  try {
    const { default: streamingCleanupService } =
      await import("../workers/StreamingCleanupService");
    const result = await streamingCleanupService.runCleanup();

    res.json({
      success: true,
      message: "Cleanup completed",
      cleaned: result.cleaned,
      remaining: result.remaining,
    });
  } catch (error) {
    console.error("Error running streaming cleanup:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to run cleanup",
    });
  }
});

// ============================================
// UNIFIED STREAM EXECUTION ENDPOINT
// ============================================

/**
 * Unified stream node execution endpoint
 * POST /stream/:source/register
 *
 * Single orchestrator for streaming trigger nodes (BinanceStreamData, AlpacaStreamData, etc.)
 * Handles subscription AND listener registration atomically - eliminates race conditions.
 * Frontend makes ONE call; backend owns all broker/source logic.
 */
router.post("/:source/register", async (req, res) => {
  try {
    const userId = req.user?.id;
    const source = req.params.source;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      workflowId,
      node_id,
      node_type,
      category,
      mode = "subscribe",
      symbols,
      assetType,
      exchange,
      crypto_base,
      crypto_quote,
      stream_type,
      stream_types,
      credential_id,
      environment,
      marketType,
      contractType,
      feed,
      interval,
      depth_levels,
      scope = "workflow",
      onlyClosedBars,
    } = req.body as StreamExecutionRequest & {
      stream_types?: string[] | string;
    };
    const { account_id, accountHash } = req.body as {
      account_id?: string;
      accountHash?: string;
    };

    if (!workflowId) {
      return res.status(400).json({ error: "workflowId is required" });
    }
    if (!node_id) {
      return res.status(400).json({ error: "node_id is required" });
    }
    if (!node_type) {
      return res.status(400).json({ error: "node_type is required" });
    }

    const sourceId = resolveStreamSourceId(source, category, assetType);

    if (!sourceId) {
      return res.status(400).json({ error: `Unknown source: ${sourceId}` });
    }

    // Parse symbols (crypto-aware)
    const cryptoSymbols = buildCryptoSymbols(
      assetType,
      crypto_base,
      crypto_quote,
    );
    const parsedSymbols: string[] =
      cryptoSymbols.length > 0 ? cryptoSymbols : normalizeSymbolList(symbols);

    // Dhan nodes historically send `stream_types`; most broker nodes send `stream_type`.
    const streamType = normalizeStreamTypeList(stream_type);

    // Split order_update from market stream types (same pattern as /subscribe endpoint)
    //const hasOrderUpdate = parsedstreamType.includes("ORDER_TRADE_UPDATE");
    const ORDER_UPDATE_MARKERS = new Set([
      "trade_updates",
      "ORDER_TRADE_UPDATE",
      "ALGO_UPDATE",
      "executionReport",
      "account_activity",
      "order_alert",
    ]);
    // Split trading lifecycle marker from market stream types
    const hasOrderUpdate = streamType.some((streamName) =>
      ORDER_UPDATE_MARKERS.has(streamName),
    );
    const hasNews = streamType.some((streamName) =>
      NEWS_MARKERS.has(streamName),
    );
    const { marketstreamType, tradingstreamType, newsStreamType } =
      streamType.reduce(
        (acc, t: string) => {
          if (ORDER_UPDATE_MARKERS.has(t)) {
            acc.tradingstreamType.push(t);
          } else if (NEWS_MARKERS.has(t)) {
            acc.newsStreamType.push(t);
          } else {
            acc.marketstreamType.push(t);
          }
          return acc;
        },
        {
          marketstreamType: [] as string[],
          tradingstreamType: [] as string[],
          newsStreamType: [] as string[],
        },
      );

    // If subscribe mode, subscribe first and WAIT for readiness
    if (mode === "subscribe") {
      if (marketstreamType.length > 0 && parsedSymbols.length === 0) {
        return res.status(400).json({
          error:
            "Subscribe mode requires at least one symbol for market streams",
        });
      }

      console.log(
        `📡 [ExecuteStreamNode] Subscribe mode - subscribing ${parsedSymbols.length} symbols`,
      );
      const requiredEnvironment = environment as string;

      // Subscribe to trading source for order updates
      if (hasOrderUpdate) {
        const tradingSourceId = getTradingCompanionSource(source);
        const tradingResult = await SubscriptionService.subscribe({
          source: tradingSourceId,
          userId,
          workflowId,
          nodeId: node_id,
          credentialId: credential_id || "",
          symbols: ["*"],
          streamType: tradingstreamType,
          exchange,
          environment: requiredEnvironment,
          assetType: assetType,
          marketType: marketType,
          contractType: undefined,
          interval: undefined,
          scope,
          targetWorkflowId: workflowId,
        });

        if (!tradingResult.success) {
          console.error(
            `❌ [ExecuteStreamNode] Trading subscription failed:`,
            tradingResult.error,
          );
          return res.status(400).json({
            success: false,
            status: "error",
            error: tradingResult.error,
          } as StreamExecutionResponse);
        }

        // Wait for trading subscription readiness
        const tradingReady = await SubscriptionService.waitForSubscriptionReady(
          {
            userId,
            source: tradingSourceId,
            environment: requiredEnvironment,
            scope,
            workflowId,
          },
        );
        if (!tradingReady) {
          console.warn(
            `⚠️ [ExecuteStreamNode] Trading subscription readiness timed out for ${tradingSourceId}; continuing in market-only mode`,
          );
        }
      }

      if (hasNews) {
        const newsSourceId = `${source}_news`;
        const newsResult = await SubscriptionService.subscribe({
          source: newsSourceId,
          userId,
          workflowId,
          nodeId: node_id,
          credentialId: credential_id || "",
          symbols: parsedSymbols,
          //symbols: ["*"],
          streamType: newsStreamType.length > 0 ? newsStreamType : ["news"],
          exchange,
          environment: requiredEnvironment,
          assetType: assetType,
          marketType: marketType,
          contractType: undefined,
          interval: undefined,
          scope,
          targetWorkflowId: workflowId,
        });

        if (!newsResult.success) {
          return res.status(400).json({
            success: false,
            status: "error",
            error: newsResult.error,
          } as StreamExecutionResponse);
        }

        await SubscriptionService.waitForSubscriptionReady({
          userId,
          source: newsSourceId,
          environment: requiredEnvironment,
          scope,
          workflowId,
        });
      }

      // Subscribe to market streams (excluding order_update)
      if (marketstreamType.length > 0) {
        const subscribeResult = await SubscriptionService.subscribe({
          source: sourceId,
          userId,
          workflowId,
          nodeId: node_id,
          credentialId: credential_id || "",
          symbols: parsedSymbols,
          streamType:
            marketstreamType.length > 0 ? marketstreamType : undefined,
          exchange,
          feed,
          environment: requiredEnvironment,
          assetType: assetType,
          marketType: marketType,
          contractType,
          interval,
          depth_levels: depth_levels,
          scope,
          targetWorkflowId: workflowId,
        });

        if (!subscribeResult.success) {
          console.error(
            `❌ [ExecuteStreamNode] Subscription failed:`,
            subscribeResult.error,
          );
          return res.status(400).json({
            success: false,
            status: "error",
            error: subscribeResult.error,
          } as StreamExecutionResponse);
        }

        // Wait for market subscription readiness
        const marketReady = await SubscriptionService.waitForSubscriptionReady({
          userId,
          source: sourceId,
          environment: requiredEnvironment,
          scope,
          workflowId,
        });
        if (!marketReady) {
          console.error(
            `❌ [ExecuteStreamNode] Market subscription readiness timed out for ${sourceId}`,
          );
          return res.status(504).json({
            success: false,
            status: "error",
            error:
              "Market data subscription timed out before readiness. Please retry.",
          } as StreamExecutionResponse);
        }
      }

      console.log(
        `✅ [ExecuteStreamNode] Subscription ready for ${parsedSymbols.length} symbols`,
      );
    }

    // Rate limit check for test listener
    const allowed =
      await RegistrationService.checkAndIncrementListenerCount(userId);

    if (!allowed) {
      console.warn(
        `⚠️ [ExecuteStreamNode] User ${userId} exceeded max test listeners (${MAX_LISTENERS_PER_USER})`,
      );
      return res.status(429).json({
        success: false,
        status: "error",
        error: `Maximum concurrent test listeners (${MAX_LISTENERS_PER_USER}) exceeded.`,
      } as StreamExecutionResponse);
    }

    // Create listener
    const listenerKey = await RegistrationService.createListener({
      userId,
      workflowId,
      nodeId: node_id,
      source: sourceId,
      mode,
      scope,
      environment,
      symbols: parsedSymbols,
      //symbols: ["*"],
      streamTypes: streamType,
      exchange,
      assetType: assetType,
      marketType: marketType,
      contractType,
      interval,
      depth_levels: depth_levels,
    });

    // Publish registration control message to market-stream-service
    // Now runs AFTER subscriptions are confirmed ready
    await RegistrationService.publishRegisterWorkflow({
      userId,
      workflowId,
      nodeId: node_id,
      source: sourceId,
      scope,
      environment,
      onlyClosedBars,
      // symbols: parsedSymbols,
      // streamTypes: streamType,
      // symbolMatchMode: "exact",
      // tradingNativeStreams: hasOrderUpdate
      //   ? getTradingNativeStreams(`${source}_trading`, marketType)
      //   : [],
    });

    console.log(
      `📡 [ExecuteStreamNode] Published register_workflow (manual test, no WorkflowRunner)`,
    );

    // Return success response
    const response: StreamExecutionResponse = {
      success: true,
      status: "listening",
      symbols: parsedSymbols || [],
      streamType: streamType || [],
      source: sourceId,
      scope: scope,
      mode: mode,
    };

    console.log(`✅ [ExecuteStreamNode] Complete - testKey: ${listenerKey}`);
    res.json(response);
  } catch (error) {
    console.error("Error executing stream node:", error);
    res.status(500).json({
      success: false,
      status: "error",
      error:
        error instanceof Error
          ? error.message
          : "Failed to execute stream node",
    } as StreamExecutionResponse);
  }
});

/**
 * Stop test listening for stream data
 * POST /stream/unregister
 *
 * Manually cancels a test listening session.
 */
router.post("/unregister", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflowId, node_id } = req.body;

    if (!workflowId || !node_id) {
      return res
        .status(400)
        .json({ error: "workflowId and node_id are required" });
    }

    const listeners = await RegistrationService.getActiveListeners(userId);
    const listener = listeners.find(
      (activeListener) =>
        activeListener.workflowId === workflowId &&
        activeListener.nodeId === node_id,
    );

    // Derive trading companion source from source family (not hardcoded list)
    if (listener?.source) {
      const sourceFamily = listener.source.split("_")[0]; // "alpaca", "binance", "dhan"
      const tradingSource = getTradingCompanionSource(sourceFamily);
      const ORDER_UPDATE_MARKERS = new Set([
        "trade_updates",
        "ORDER_TRADE_UPDATE",
        "ALGO_UPDATE",
        "executionReport",
        "account_activity",
        "order_alert",
      ]);
      const streamTypes = listener.streamTypes ?? [];
      const exchange = listener.exchange;

      // Split trading lifecycle marker from market stream types
      const hasOrderUpdate = streamTypes.some((streamName) =>
        ORDER_UPDATE_MARKERS.has(streamName),
      );

      const { marketstreamType, tradingstreamType } = streamTypes.reduce(
        (acc, t: string) => {
          if (ORDER_UPDATE_MARKERS.has(t)) {
            acc.tradingstreamType.push(t);
          } else {
            acc.marketstreamType.push(t);
          }
          return acc;
        },
        {
          marketstreamType: [] as string[],
          tradingstreamType: [] as string[],
        },
      );

      // Only unsubscribe trading if this was a market/crypto/stream source
      // (not if source is already a trading source)
      if (hasOrderUpdate) {
        await SubscriptionService.unsubscribe({
          source: tradingSource as any,
          userId,
          workflowId,
          nodeId: node_id,
          symbols: ["*"],
          streamType: tradingstreamType,
          exchange,
          marketType: listener.marketType,
          scope:
            listener.scope === "global" || listener.scope === "workflow"
              ? listener.scope
              : undefined,
          environment: listener.environment,
          targetWorkflowId: workflowId,
        });
      }

      await SubscriptionService.unsubscribe({
        source: listener?.source as any,
        userId,
        workflowId,
        nodeId: node_id,
        symbols: listener.symbols,
        streamType: marketstreamType,
        exchange,
        assetType: listener.assetType,
        marketType: listener.marketType,
        contractType: listener.contractType,
        interval: listener.interval,
        depth_levels: listener.depth_levels,
        environment: listener.environment,
        scope:
          listener.scope === "global" || listener.scope === "workflow"
            ? listener.scope
            : undefined,
        targetWorkflowId: workflowId,
      });
    }

    // Delete listener through service
    await RegistrationService.deleteListener(userId, workflowId, node_id);

    // Publish unregister control message to market-stream-service
    await RegistrationService.publishUnregisterWorkflow({
      userId,
      workflowId: workflowId,
    });

    console.log(`🛑 Stopped listener: ${workflowId}:${node_id}`);

    res.json({
      success: true,
      status: "stopped",
      message: "listener stopped",
    });
  } catch (error) {
    console.error("Error stopping listener:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to stop listener",
    });
  }
});

// ============================================
// USER STREAM CLEANUP (SIGN OUT / SESSION EXPIRY)
// ============================================

/**
 * Cleanup all test listeners for the current user
 * Called when user signs out or session expires
 * POST /stream/cleanup-user-streams
 */
router.post("/cleanup-user-streams", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.log(`🧹 [Market Cleanup] Starting cleanup for user ${userId}`);

    const result = await RegistrationService.cleanupUserListeners(userId);

    console.log(
      `✅ [Market Cleanup] Cleaned ${result.cleaned}/${result.total} test listeners for user ${userId}`,
    );

    res.json({
      success: true,
      cleaned: result.cleaned,
      total: result.total,
    });
  } catch (error) {
    console.error("Error during user stream cleanup:", error);
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to cleanup user streams",
    });
  }
});

export default router;
