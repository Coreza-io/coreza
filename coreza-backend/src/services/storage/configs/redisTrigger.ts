/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import type { StorageConfig, StorageInput, StorageContext } from "../types";
import logger from "../../../utils/logger";

export const redisTriggerConfig: StorageConfig = {
  requiresCredentials: true, // Uses user's external Redis for Pub/Sub

  operations: {
    subscribe: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const {
          workflow_id,
          node_id,
          channels,
          subscription_type = "channel",
        } = input;

        if (!workflow_id || !node_id || !channels) {
          throw new Error("workflow_id, node_id, and channels are required");
        }

        // Parse channels
        const channelList = Array.isArray(channels)
          ? channels
          : typeof channels === "string"
            ? channels
                .split(",")
                .map((c: string) => c.trim())
                .filter(Boolean)
            : [];

        if (channelList.length === 0) {
          throw new Error("channels must be a non-empty array");
        }

        // Import RedisPubSubSubscriber from market-stream-service
        const { RedisPubSubSubscriber } =
          await import("../../../../market-stream-service/src/services/RedisPubSubSubscriber");

        const subscriber = RedisPubSubSubscriber.getInstance();

        // Subscribe workflow to Redis channels
        await subscriber.subscribe(
          workflow_id,
          node_id,
          ctx.userId,
          channelList,
          subscription_type as "channel" | "pattern",
        );

        logger.info(
          {
            workflowId: workflow_id,
            nodeId: node_id,
            userId: ctx.userId,
            channels: channelList,
            type: subscription_type,
          },
          "Redis Pub/Sub subscription created",
        );

        return {
          success: true,
          message: `Subscribed to ${channelList.length} Redis ${subscription_type}(s)`,
          channels: channelList,
          subscriptionType: subscription_type,
        };
      },
    },

    unsubscribe: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { workflow_id } = input;

        if (!workflow_id) {
          throw new Error("workflow_id is required");
        }

        const { RedisPubSubSubscriber } =
          await import("../../../../market-stream-service/src/services/RedisPubSubSubscriber");

        const subscriber = RedisPubSubSubscriber.getInstance();
        await subscriber.unsubscribe(workflow_id);

        logger.info(
          { workflowId: workflow_id },
          "Redis Pub/Sub subscription removed",
        );

        return {
          success: true,
          message: "Unsubscribed from Redis channels",
        };
      },
    },
  },
};

export default redisTriggerConfig;
