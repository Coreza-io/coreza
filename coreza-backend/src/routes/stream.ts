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

import express from "express";
import { requireAuth } from "../middleware/jwtAuth";
import { SubscriptionService } from "../services/SubscriptionService";
import { getRedisCache } from "../config/redis";
import { supabase } from "../config/supabase";
import { getAllowedSymbols } from "../utils/streamFilters";
import {
  MAX_LISTENERS_PER_USER,
  LISTENER_TTL_SECONDS,
  LUA_INCREMENT_LISTENER_COUNT,
  LUA_DECREMENT_LISTENER_COUNT,
} from "../config/streaming";
import {
  StreamExecutionRequest,
  StreamExecutionResponse,
} from "../types/streaming";

const router = express.Router();

// Apply JWT auth to all routes
router.use(requireAuth);

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

    const redis = getRedisCache();

    // Get all gateway states
    const gatewayKeys = await redis.keys(`md:gateway:${userId}:*:state`);
    const sources: any[] = [];

    for (const key of gatewayKeys) {
      const stateStr = await redis.get(key);
      if (stateStr) {
        try {
          const state = JSON.parse(stateStr);
          const sourceMatch = key.match(
            new RegExp(`^md:gateway:${userId}:([^:]+):state$`),
          );
          if (sourceMatch) {
            sources.push({
              source: sourceMatch[1],
              connected: state.connected || false,
              symbols: state.symbols || [],
              eventTypes: state.eventTypes || [],
              connectedAt: state.connectedAt || null,
              lastMessageAt: state.lastMessageAt || null,
            });
          }
        } catch (e) {
          console.error("Error parsing gateway state:", key, e);
        }
      }
    }

    // Get workflow registrations for this user (user-scoped pattern)
    const workflowRegKeys = await redis.keys(`md:user:${userId}:wf:reg:*`);
    const workflowRegs: any[] = [];
    const workflowIds = new Set<string>();

    for (const key of workflowRegKeys) {
      const regStr = await redis.get(key);
      if (regStr) {
        try {
          const reg = JSON.parse(regStr);
          workflowRegs.push({
            workflowId: reg.workflowId,
            nodeId: reg.nodeId,
            symbols: reg.symbols || [],
            eventTypes: reg.eventTypes || [],
            source: reg.source || "unknown",
            isActive: true,
          });
          if (reg.workflowId) {
            workflowIds.add(reg.workflowId);
          }
        } catch (e) {
          console.error("Error parsing workflow registration:", key, e);
        }
      }
    }

    // Also check active streaming workflows set and include those not in wf:reg:*
    const activeStreamingWorkflows = await redis.smembers(
      `md:user:${userId}:active_streaming_workflows`,
    );
    for (const workflowId of activeStreamingWorkflows) {
      workflowIds.add(workflowId);

      // Check if this workflow is already in workflowRegs
      const alreadyIncluded = workflowRegs.some(
        (reg) => reg.workflowId === workflowId,
      );
      if (!alreadyIncluded) {
        // Try to get additional info from stream filter
        const filterStr = await redis.get(
          `md:user:${userId}:workflow:${workflowId}:stream_filter`,
        );
        let source = "unknown";
        let eventTypes: string[] = [];

        if (filterStr) {
          try {
            const filter = JSON.parse(filterStr);
            source = filter.source || "unknown";
            eventTypes = filter.eventTypes || [];
          } catch (e) {
            /* ignore parse errors */
          }
        }

        workflowRegs.push({
          workflowId,
          nodeId: "",
          symbols: [], // May not have explicit symbols
          eventTypes,
          source,
          isActive: true,
        });
      }
    }

    // Fetch workflow names from Supabase
    const workflowNames: Record<string, string> = {};
    if (workflowIds.size > 0) {
      const { data: workflows } = await supabase
        .from("workflows")
        .select("id, name")
        .in("id", Array.from(workflowIds));

      if (workflows) {
        for (const wf of workflows) {
          workflowNames[wf.id] = wf.name;
        }
      }
    }

    // Add workflow names to registrations
    const workflowsWithNames = workflowRegs.map((reg) => ({
      ...reg,
      workflowName: workflowNames[reg.workflowId] || "Unknown Workflow",
    }));

    // Get user-level symbol subscriptions (from Subscribe nodes - global scope)
    const userSubKeys = await redis.keys(
      `md:user:${userId}:subscribed_symbols:*`,
    );
    const userSubscriptions: Record<string, string[]> = {};

    for (const key of userSubKeys) {
      const sourceMatch = key.match(/md:user:.*:subscribed_symbols:(\w+)/);
      if (sourceMatch) {
        const symbols = await redis.smembers(key);
        if (symbols.length > 0) {
          userSubscriptions[sourceMatch[1]] = symbols;
        }
      }
    }

    // Get workflow-scoped subscriptions (from Subscribe nodes - workflow scope)
    const scopedSubKeys = await redis.keys(
      `md:user:${userId}:workflow:*:subscribed_symbols:*`,
    );
    const workflowScopedSubscriptions: Array<{
      workflowId: string;
      workflowName?: string;
      source: string;
      symbols: string[];
    }> = [];
    const scopedWorkflowIds = new Set<string>();

    for (const key of scopedSubKeys) {
      // Pattern: workflow:{workflowId}:subscribed_symbols:{source}
      const regex = new RegExp(
        `^md:user:${userId}:workflow:([^:]+):subscribed_symbols:([a-zA-Z0-9_]+)$`,
      );

      const match = key.match(regex);

      if (match) {
        const [, wfId, source] = match;
        const symbols = await redis.smembers(key);
        if (symbols.length > 0) {
          workflowScopedSubscriptions.push({
            workflowId: wfId,
            source,
            symbols,
          });
          scopedWorkflowIds.add(wfId);
        }
      }
    }

    // Fetch workflow names for scoped subscriptions
    if (scopedWorkflowIds.size > 0) {
      const { data: scopedWorkflows } = await supabase
        .from("workflows")
        .select("id, name")
        .in("id", Array.from(scopedWorkflowIds));

      if (scopedWorkflows) {
        for (const sub of workflowScopedSubscriptions) {
          const wf = scopedWorkflows.find((w) => w.id === sub.workflowId);
          sub.workflowName = wf?.name || "Unknown Workflow";
        }
      }
    }

    // Calculate stats and build symbol-source map
    const allSymbols = new Set<string>();
    const symbolSourceMap: Record<string, string[]> = {};

    sources.forEach((s) =>
      s.symbols.forEach((sym: string) => {
        allSymbols.add(sym);
        if (!symbolSourceMap[sym]) symbolSourceMap[sym] = [];
        if (!symbolSourceMap[sym].includes(s.source))
          symbolSourceMap[sym].push(s.source);
      }),
    );

    workflowRegs.forEach((w) =>
      w.symbols.forEach((sym: string) => {
        allSymbols.add(sym);
        if (!symbolSourceMap[sym]) symbolSourceMap[sym] = [];
        if (!symbolSourceMap[sym].includes(w.source))
          symbolSourceMap[sym].push(w.source);
      }),
    );

    // Add user-level subscriptions to symbol counts
    Object.entries(userSubscriptions).forEach(([source, symbols]) => {
      symbols.forEach((sym) => {
        allSymbols.add(sym);
        if (!symbolSourceMap[sym]) symbolSourceMap[sym] = [];
        if (!symbolSourceMap[sym].includes(source))
          symbolSourceMap[sym].push(source);
      });
    });

    // Add workflow-scoped subscriptions to symbol counts
    workflowScopedSubscriptions.forEach((sub) => {
      sub.symbols.forEach((sym) => {
        allSymbols.add(sym);
        if (!symbolSourceMap[sym]) symbolSourceMap[sym] = [];
        if (!symbolSourceMap[sym].includes(sub.source))
          symbolSourceMap[sym].push(sub.source);
      });
    });

    res.json({
      sources,
      workflows: workflowsWithNames,
      userSubscriptions, // Global subscriptions from Subscribe nodes
      workflowScopedSubscriptions, // Workflow-scoped subscriptions from Subscribe nodes
      stats: {
        totalSources: sources.filter((s) => s.connected).length,
        totalSymbols: allSymbols.size,
        totalWorkflows: workflowRegs.length,
        connectedSources: sources
          .filter((s) => s.connected)
          .map((s) => s.source),
      },
      symbolSourceMap,
    });
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

// Source mapping is now auto-generated in config/marketSources.ts
// Import: SOURCE_TO_MARKET_SOURCE, getMarketSource

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
      workflow_id,
      stream_types,
      data_type, // NEW: Data type (market, news, etc.)
      // Source-specific fields
      feed, // Alpaca: iex or sip
      environment, // Binance: testnet or live
      asset_type, // Binance: spot or futures
      interval, // Binance: 1m, 5m, 15m, etc.
      depth_levels,
      // Subscription scope
      subscriptionScope,
      targetWorkflowId,
    } = req.body;

    if (!credential_id)
      return res.status(400).json({ error: "credential_id is required" });

    if (!node_id) return res.status(400).json({ error: "node_id is required" });

    const sourceId = `${source}_${data_type}`;

    if (!sourceId) {
      return res.status(400).json({ error: `Unknown source: ${sourceId}` });
    }

    const result = await SubscriptionService.subscribe({
      source: sourceId,
      userId,
      workflowId: workflow_id,
      nodeId: node_id,
      credentialId: credential_id,
      symbols,
      streamTypes: stream_types
        ? typeof stream_types === "string"
          ? stream_types.split(",").map((s: string) => s.trim())
          : stream_types
        : undefined,
      feed,
      environment,
      assetType: asset_type,
      interval,
      depth_levels: depth_levels,
      subscriptionScope,
      targetWorkflowId,
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      message: result.data?.message,
      symbols: result.data?.symbols,
      stream_types: result.data?.streamTypes,
      sourceId,
      node_id,
      workflow_id: workflow_id || null,
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
      workflow_id,
      stream_types,
      data_type, // NEW: Data type (market, news, etc.)
      // Source-specific fields
      feed, // Alpaca: iex or sip
      environment, // Binance: testnet or live
      asset_type, // Binance: spot or futures
      interval, // Binance: 1m, 5m, 15m, etc.
      depth_levels,
      // Subscription scope
      subscriptionScope,
      targetWorkflowId,
    } = req.body;

    let sourceId;
    if (data_type) {
      sourceId = `${source}_${data_type}`;
    } else {
      sourceId = source;
    }

    if (!sourceId) {
      return res.status(400).json({ error: `Unknown source: ${sourceId}` });
    }

    const result = await SubscriptionService.unsubscribe({
      source: sourceId,
      userId,
      workflowId: workflow_id,
      nodeId: node_id,
      credentialId: credential_id,
      symbols,
      streamTypes: stream_types
        ? typeof stream_types === "string"
          ? stream_types.split(",").map((s: string) => s.trim())
          : stream_types
        : undefined,
      feed,
      environment,
      assetType: asset_type,
      interval,
      depth_levels: depth_levels,
      subscriptionScope,
      targetWorkflowId,
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      message: result.data?.message,
      sourceId,
      symbols: result.data?.symbols,
      stream_types: result.data?.streamTypes,
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

    const { workflow_id, node_id } = req.body;

    if (!workflow_id || !node_id) {
      return res
        .status(400)
        .json({ error: "workflow_id and node_id are required" });
    }

    const redis = getRedisCache();
    // Use user-scoped key pattern: md:user:{userId}:wf:reg:{workflowId}
    const regKey = `md:user:${userId}:wf:reg:${workflow_id}`;

    const data = await redis.get(regKey);
    if (!data) {
      return res.status(404).json({ error: "Registration not found" });
    }

    const subscription = JSON.parse(data);
    subscription.lastActivityAt = new Date().toISOString();
    await redis.set(regKey, JSON.stringify(subscription));

    res.json({
      success: true,
      message: "Registration activity updated",
      lastActivityAt: subscription.lastActivityAt,
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
      await import("../services/StreamingCleanupService");
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
      workflow_id,
      node_id,
      node_type,
      mode = "listen",
      // Subscribe params
      symbols,
      data_type,
      stream_types,
      credential_id,
      environment,
      asset_type,
      feed,
      interval,
      depth_levels,
      subscriptionMode,
    } = req.body as StreamExecutionRequest;

    if (!workflow_id) {
      return res.status(400).json({ error: "workflow_id is required" });
    }
    if (!node_id) {
      return res.status(400).json({ error: "node_id is required" });
    }
    if (!node_type) {
      return res.status(400).json({ error: "node_type is required" });
    }

    const sourceId = `${source}_${data_type}`;

    if (!sourceId) {
      return res.status(400).json({ error: `Unknown source: ${sourceId}` });
    }

    const redis = getRedisCache();

    // 2. Parse symbols
    const parsedSymbols: string[] = Array.isArray(symbols)
      ? symbols.map((s: string) => s.toUpperCase())
      : typeof symbols === "string"
        ? symbols
            .split(",")
            .map((s: string) => s.trim().toUpperCase())
            .filter(Boolean)
        : [];

    // 3. If subscribe mode, subscribe first and WAIT for completion
    if (mode === "subscribe") {
      if (parsedSymbols.length === 0) {
        return res
          .status(400)
          .json({ error: "Subscribe mode requires at least one symbol" });
      }

      console.log(
        `📡 [ExecuteStreamNode] Subscribe mode - subscribing ${parsedSymbols.length} symbols`,
      );

      const subscribeResult = await SubscriptionService.subscribe({
        source: sourceId,
        userId,
        workflowId: workflow_id,
        nodeId: node_id,
        credentialId: credential_id || "",
        symbols: parsedSymbols,
        streamTypes: stream_types
          ? typeof stream_types === "string"
            ? stream_types.split(",").map((s: string) => s.trim())
            : stream_types
          : undefined,
        feed,
        environment,
        assetType: asset_type,
        interval,
        depth_levels: depth_levels,
        subscriptionScope: "workflow",
        targetWorkflowId: workflow_id,
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

      console.log(
        `✅ [ExecuteStreamNode] Subscription successful for ${parsedSymbols.length} symbols`,
      );
    }

    // 5. Rate limit check for test listener
    const userListenerCountKey = `md:user:${userId}:stream:listener_count`;
    const allowed = await redis.eval(
      LUA_INCREMENT_LISTENER_COUNT,
      1,
      userListenerCountKey,
      String(MAX_LISTENERS_PER_USER),
      String(LISTENER_TTL_SECONDS),
    );

    if (allowed === 0) {
      console.warn(
        `⚠️ [ExecuteStreamNode] User ${userId} exceeded max test listeners (${MAX_LISTENERS_PER_USER})`,
      );
      return res.status(429).json({
        success: false,
        status: "error",
        error: `Maximum concurrent test listeners (${MAX_LISTENERS_PER_USER}) exceeded.`,
      } as StreamExecutionResponse);
    }

    // 6. Create listener key and store metadata
    const listenerKey = `md:user:${userId}:stream:${workflow_id}:${node_id}`;
    const now = new Date().toISOString();

    const listenerData = {
      userId,
      workflowId: workflow_id,
      nodeId: node_id,
      status: "listening",
      startedAt: now,
      mode,
      subscriptionMode: subscriptionMode,
      source: sourceId,
    };

    // Store test listener with TTL (auto-expire)
    await redis.setex(
      listenerKey,
      LISTENER_TTL_SECONDS,
      JSON.stringify(listenerData),
    );

    // Add to user-specific SET for efficient per-user queries (no pattern scanning)
    const userListenersKey = `md:user:${userId}:stream:active_listeners`;
    await redis.sadd(userListenersKey, listenerKey);

    // 7. Register with MarketDataSubscriber via control message
    // CRITICAL: Include filter_symbols so MarketControlHandler subscribes to correct Redis channels
    const controlMessage = {
      action: "register_workflow",
      userId,
      workflowId: workflow_id, // Use testKey as pseudo workflow ID for uniqueness
      nodeId: node_id,
      source: sourceId,
      subscriptionMode: subscriptionMode,
    };

    await redis.publish(
      "md:control:register_workflow",
      JSON.stringify(controlMessage),
    );
    console.log(`📡 [ExecuteStreamNode] Published register_workflow}`);

    // 8. Return success response
    const response: StreamExecutionResponse = {
      success: true,
      status: "listening",
      symbols: parsedSymbols || [],
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
 * POST /stream/stop-listen-stream
 *
 * Manually cancels a test listening session.
 */
router.post("/unregister", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflow_id, node_id } = req.body;

    if (!workflow_id || !node_id) {
      return res
        .status(400)
        .json({ error: "workflow_id and node_id are required" });
    }

    const redis = getRedisCache();
    const listenerKey = `md:user:${userId}:stream:${workflow_id}:${node_id}`;

    // Delete both test listener and any stored result
    await redis.del(listenerKey);

    // Remove from user-specific SET
    const userListenersKey = `md:user:${userId}:stream:active_listeners`;
    await redis.srem(userListenersKey, listenerKey);

    // Decrement user's test listener count
    const userCountKey = `md:user:${userId}:stream:listener_count`;
    await redis.eval(LUA_DECREMENT_LISTENER_COUNT, 1, userCountKey);

    // Unregister from MarketDataSubscriber by publishing unsubscribe control message
    const unsubscribeMessage = {
      action: "unregister_workflow",
      workflowId: workflow_id,
      userId,
    };
    await redis.publish(
      "md:control:unregister_workflow",
      JSON.stringify(unsubscribeMessage),
    );

    console.log(`🛑 Stopped listener: ${listenerKey}`);

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

    const redis = getRedisCache();
    const userTestListenersKey = getUserListenersKey(userId);

    // Get all test listener keys for this user
    const testListenerKeys = await redis.smembers(userTestListenersKey);
    console.log(
      `🧹 [Market Cleanup] Found ${testListenerKeys.length} test listeners to clean up`,
    );

    let cleanedCount = 0;

    for (const testKey of testListenerKeys) {
      try {
        // Get listener data to log what we're cleaning
        const listenerJson = await redis.get(testKey);
        if (listenerJson) {
          const listenerData = JSON.parse(listenerJson);
          console.log(
            `🧹 [Market Cleanup] Cleaning test listener: ${testKey}`,
            {
              source: listenerData.source,
              symbols: listenerData.filterSymbols,
            },
          );
        }

        // Delete the test key
        await redis.del(testKey);

        // Delete the result key if exists
        await redis.del(`${testKey}:result`);

        // Remove from user's test listeners set
        await redis.srem(userTestListenersKey, testKey);

        // Remove from global active listeners
        await redis.srem(REDIS_KEY_ACTIVE_LISTENERS, testKey);

        // Publish unregister message to market-stream-service
        const unregisterMsg = {
          action: "unregister_workflow",
          userId,
          workflowId: testKey,
          isTestListener: true,
        };
        await redis.publish(
          "md:control:unregister_workflow",
          JSON.stringify(unregisterMsg),
        );

        cleanedCount++;
      } catch (err) {
        console.error(
          `⚠️ [Market Cleanup] Failed to cleanup test listener ${testKey}:`,
          err,
        );
      }
    }

    // Reset user's test listener count
    const userCountKey = `${REDIS_KEY_USER_TEST_COUNT_PREFIX}${userId}`;
    await redis.del(userCountKey);

    console.log(
      `✅ [Market Cleanup] Cleaned ${cleanedCount}/${testListenerKeys.length} test listeners for user ${userId}`,
    );

    res.json({
      success: true,
      cleaned: cleanedCount,
      total: testListenerKeys.length,
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
