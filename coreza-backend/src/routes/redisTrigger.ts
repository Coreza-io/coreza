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
import logger from "../utils/logger";

const router = express.Router();

// Apply JWT auth to all routes
router.use(requireAuth);

/**
 * POST /redis/trigger/subscribe
 * Subscribe to Redis Pub/Sub channels for workflow triggering
 * This route forwards subscription requests to market-stream-service's RedisPubSubSubscriber
 */
router.post("/subscribe", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      workflow_id,
      node_id,
      credential_id,
      subscription_type = "channel",
      channels,
    } = req.body;

    if (!workflow_id || !node_id || !credential_id || !channels) {
      return res.status(400).json({
        error: "workflow_id, node_id, credential_id, and channels are required",
      });
    }

    if (!Array.isArray(channels) || channels.length === 0) {
      return res.status(400).json({
        error: "channels must be a non-empty array",
      });
    }

    // Import RedisPubSubSubscriber from market-stream-service
    // In production, this would be a separate service call
    // For now, we'll use dynamic import since it's in the same codebase
    const { RedisPubSubSubscriber } = await import(
      "../../market-stream-service/src/services/RedisPubSubSubscriber"
    );

    const subscriber = RedisPubSubSubscriber.getInstance();

    // Subscribe workflow to Redis channels
    await subscriber.subscribe(
      workflow_id,
      node_id,
      userId,
      channels,
      subscription_type as "channel" | "pattern"
    );

    logger.info(
      {
        workflowId: workflow_id,
        nodeId: node_id,
        userId,
        channels,
        type: subscription_type,
      },
      "Redis Pub/Sub subscription created"
    );

    res.json({
      success: true,
      message: `Subscribed to ${channels.length} Redis ${subscription_type}(s)`,
      channels,
      subscriptionType: subscription_type,
    });
  } catch (error) {
    logger.error({ err: error }, "Redis trigger subscription failed");
    res.status(500).json({
      error: "Failed to create Redis subscription",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /redis/trigger/unsubscribe
 * Unsubscribe workflow from Redis Pub/Sub channels
 */
router.post("/unsubscribe", async (req, res) => {
  try {
    const { workflow_id } = req.body;

    if (!workflow_id) {
      return res.status(400).json({
        error: "workflow_id is required",
      });
    }

    const { RedisPubSubSubscriber } = await import(
      "../../market-stream-service/src/services/RedisPubSubSubscriber"
    );

    const subscriber = RedisPubSubSubscriber.getInstance();
    await subscriber.unsubscribe(workflow_id);

    logger.info({ workflowId: workflow_id }, "Redis Pub/Sub subscription removed");

    res.json({
      success: true,
      message: "Unsubscribed from Redis channels",
    });
  } catch (error) {
    logger.error({ err: error }, "Redis trigger unsubscription failed");
    res.status(500).json({
      error: "Failed to unsubscribe from Redis",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
