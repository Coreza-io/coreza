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
import { RegistrationService } from "../services/RegistrationService";
import { StatusService } from "../services/StatusService";
import { MAX_LISTENERS_PER_USER } from "../config/streaming";
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
      workflow_id,
      stream_types,
      data_type,
      feed,
      environment,
      asset_type,
      interval,
      depth_levels,
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
      data_type,
      feed,
      environment,
      asset_type,
      interval,
      depth_levels,
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

    const success = await RegistrationService.updateActivity(userId, workflow_id);

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

    // Parse symbols
    const parsedSymbols: string[] = Array.isArray(symbols)
      ? symbols.map((s: string) => s.toUpperCase())
      : typeof symbols === "string"
        ? symbols
            .split(",")
            .map((s: string) => s.trim().toUpperCase())
            .filter(Boolean)
        : [];

    // If subscribe mode, subscribe first and WAIT for completion
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

    // Rate limit check for test listener
    const allowed = await RegistrationService.checkAndIncrementListenerCount(userId);

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
      workflowId: workflow_id,
      nodeId: node_id,
      source: sourceId,
      mode,
      subscriptionMode,
    });

    // Publish registration control message to market-stream-service
    await RegistrationService.publishRegisterWorkflow({
      userId,
      workflowId: workflow_id,
      nodeId: node_id,
      source: sourceId,
      subscriptionMode,
    });

    console.log(`📡 [ExecuteStreamNode] Published register_workflow`);

    // Return success response
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

    const { workflow_id, node_id } = req.body;

    if (!workflow_id || !node_id) {
      return res
        .status(400)
        .json({ error: "workflow_id and node_id are required" });
    }

    // Delete listener through service
    await RegistrationService.deleteListener(userId, workflow_id, node_id);

    // Publish unregister control message to market-stream-service
    await RegistrationService.publishUnregisterWorkflow({
      userId,
      workflowId: workflow_id,
    });

    console.log(`🛑 Stopped listener: ${workflow_id}:${node_id}`);

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
