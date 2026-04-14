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

/**
 * ============================================
 * REGISTRATION SERVICE
 * ============================================
 *
 * Centralized service for managing test listener registrations.
 * Handles rate limiting, creation, deletion, activity tracking, and cleanup.
 *
 * All Redis operations use keys from REDIS_CHANNELS for consistency.
 */

import { getRedisCache } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import {
  MAX_LISTENERS_PER_USER,
  LISTENER_TTL_SECONDS,
  LUA_INCREMENT_LISTENER_COUNT,
  LUA_DECREMENT_LISTENER_COUNT,
} from "../config/streaming";
import logger from "../utils/logger";

// ============================================
// TYPES
// ============================================

export interface ListenerParams {
  userId: string;
  workflowId: string;
  nodeId: string;
  source: string;
  mode: string;
  scope: string;
  environment: string;
  filterSymbols?: string[];
  filterTypes?: string[];
  assetType?: string;
  marketType?: string;
  interval?: string;
  depth_levels?: string;
}

export interface ListenerData {
  userId: string;
  workflowId: string;
  nodeId: string;
  status: "listening" | "stopped";
  startedAt: string;
  mode: string;
  scope: string;
  source: string;
  environment: string;
  filterSymbols?: string[];
  filterTypes?: string[];
  assetType?: string;
  marketType?: string;
  interval?: string;
  depth_levels?: string;
}

export interface CleanupResult {
  cleaned: number;
  total: number;
}

// ============================================
// REGISTRATION SERVICE
// ============================================

export class RegistrationService {
  /**
   * Check and increment listener count (rate limiting)
   * Returns true if allowed, false if limit exceeded
   */
  static async checkAndIncrementListenerCount(
    userId: string,
  ): Promise<boolean> {
    const redis = getRedisCache();
    const countKey = REDIS_CHANNELS.userListenerCount(userId);

    const allowed = await redis.eval(
      LUA_INCREMENT_LISTENER_COUNT,
      1,
      countKey,
      String(MAX_LISTENERS_PER_USER),
      String(LISTENER_TTL_SECONDS),
    );

    if (allowed === 0) {
      logger.warn(
        { userId, maxListeners: MAX_LISTENERS_PER_USER },
        "User exceeded max test listeners",
      );
      return false;
    }

    return true;
  }

  /**
   * Decrement listener count when a listener is stopped
   */
  static async decrementListenerCount(userId: string): Promise<void> {
    const redis = getRedisCache();
    const countKey = REDIS_CHANNELS.userListenerCount(userId);
    await redis.eval(LUA_DECREMENT_LISTENER_COUNT, 1, countKey);
  }

  /**
   * Create a test listener with TTL
   */
  static async createListener(params: ListenerParams): Promise<string> {
    const {
      userId,
      workflowId,
      nodeId,
      source,
      mode = "listen",
      scope,
      environment,
      filterSymbols,
      filterTypes,
      assetType,
      marketType,
      interval,
      depth_levels,
    } = params;
    const redis = getRedisCache();

    const listenerKey = REDIS_CHANNELS.Listener(userId, workflowId, nodeId);
    const now = new Date().toISOString();

    const listenerData: ListenerData = {
      userId,
      workflowId,
      nodeId,
      status: "listening",
      startedAt: now,
      mode,
      scope,
      source,
      environment,
      filterSymbols,
      filterTypes,
      assetType,
      marketType,
      interval,
      depth_levels,
    };

    // Store listener with TTL (auto-expire)
    await redis.setex(
      listenerKey,
      LISTENER_TTL_SECONDS,
      JSON.stringify(listenerData),
    );

    // Add to user's active listeners SET for efficient per-user queries
    const userListenersKey = REDIS_CHANNELS.userActiveListeners(userId);
    await redis.sadd(userListenersKey, listenerKey);

    logger.debug(
      { userId, workflowId, nodeId, source, listenerKey },
      "Created test listener",
    );

    return listenerKey;
  }

  /**
   * Delete a test listener and clean up associated resources
   */
  static async deleteListener(
    userId: string,
    workflowId: string,
    nodeId: string,
  ): Promise<void> {
    const redis = getRedisCache();

    const listenerKey = REDIS_CHANNELS.Listener(userId, workflowId, nodeId);
    const resultKey = REDIS_CHANNELS.ListenerResult(userId, workflowId, nodeId);
    const userListenersKey = REDIS_CHANNELS.userActiveListeners(userId);

    // Delete listener and result keys
    await redis.del(listenerKey);
    await redis.del(resultKey);

    // Remove from user's active listeners SET
    await redis.srem(userListenersKey, listenerKey);

    // Decrement count
    await this.decrementListenerCount(userId);

    logger.debug(
      { userId, workflowId, nodeId, listenerKey },
      "Deleted test listener",
    );
  }

  /**
   * Get all active listeners for a user
   */
  static async getActiveListeners(userId: string): Promise<ListenerData[]> {
    const redis = getRedisCache();
    const userListenersKey = REDIS_CHANNELS.userActiveListeners(userId);

    const listenerKeys = await redis.smembers(userListenersKey);
    const listeners: ListenerData[] = [];

    for (const key of listenerKeys) {
      const data = await redis.get(key);
      if (data) {
        try {
          listeners.push(JSON.parse(data));
        } catch {
          // Key exists in SET but data is invalid, clean up
          await redis.srem(userListenersKey, key);
        }
      } else {
        // Key exists in SET but not in Redis, clean up orphan
        await redis.srem(userListenersKey, key);
      }
    }

    return listeners;
  }

  /**
   * Update activity timestamp for a workflow registration
   */
  static async updateActivity(
    userId: string,
    workflowId: string,
  ): Promise<boolean> {
    const redis = getRedisCache();
    const regKey = REDIS_CHANNELS.workflowRegistration(userId, workflowId);

    const data = await redis.get(regKey);
    if (!data) {
      return false;
    }

    try {
      const registration = JSON.parse(data);
      registration.lastActivityAt = new Date().toISOString();
      await redis.set(regKey, JSON.stringify(registration));
      return true;
    } catch (error) {
      logger.warn(
        { userId, workflowId, error },
        "Failed to update registration activity",
      );
      return false;
    }
  }

  /**
   * Publish registration control message to market-stream-service
   */
  static async publishRegisterWorkflow(params: {
    userId: string;
    workflowId: string;
    nodeId: string;
    source: string;
    scope: string;
    environment: string;
    onlyClosedBars?: boolean;
    isLive?: boolean;
  }): Promise<void> {
    const redis = getRedisCache();

    const controlMessage = {
      action: "register_workflow",
      userId: params.userId,
      workflowId: params.workflowId,
      nodeId: params.nodeId,
      source: params.source,
      scope: params.scope,
      environment: params.environment,
      onlyClosedBars: params.onlyClosedBars ?? true, // Default to true
      isLive: params.isLive ?? false,
    };

    await redis.publish(
      REDIS_CHANNELS.controlRegister,
      JSON.stringify(controlMessage),
    );

    logger.debug({ ...params }, "Published register_workflow control message");
  }

  /**
   * Publish unregistration control message to market-stream-service
   */
  static async publishUnregisterWorkflow(params: {
    userId: string;
    workflowId: string;
    isTestListener?: boolean;
  }): Promise<void> {
    const redis = getRedisCache();

    const controlMessage = {
      action: "unregister_workflow",
      userId: params.userId,
      workflowId: params.workflowId,
      isTestListener: params.isTestListener,
    };

    await redis.publish(
      REDIS_CHANNELS.controlUnregister,
      JSON.stringify(controlMessage),
    );

    logger.debug(
      { ...params },
      "Published unregister_workflow control message",
    );
  }

  /**
   * Cleanup all test listeners for a user (e.g., on sign out)
   */
  static async cleanupUserListeners(userId: string): Promise<CleanupResult> {
    const redis = getRedisCache();
    const userListenersKey = REDIS_CHANNELS.userActiveListeners(userId);

    // Get all test listener keys for this user
    const listenerKeys = await redis.smembers(userListenersKey);
    let cleanedCount = 0;

    for (const listenerKey of listenerKeys) {
      try {
        // Get listener data for logging
        const listenerJson = await redis.get(listenerKey);
        if (listenerJson) {
          const listenerData = JSON.parse(listenerJson);
          logger.debug(
            { listenerKey, source: listenerData.source },
            "Cleaning up test listener",
          );
        }

        // Delete the listener key and result key
        await redis.del(listenerKey);
        await redis.del(`${listenerKey}:result`);

        // Remove from user's active listeners SET
        await redis.srem(userListenersKey, listenerKey);

        // Publish unregister message to market-stream-service
        await this.publishUnregisterWorkflow({
          userId,
          workflowId: listenerKey, // Use full key as identifier
          isTestListener: true,
        });

        cleanedCount++;
      } catch (err) {
        logger.error(
          { listenerKey, error: err },
          "Failed to cleanup test listener",
        );
      }
    }

    // Reset user's listener count
    const countKey = REDIS_CHANNELS.userListenerCount(userId);
    await redis.del(countKey);

    logger.info(
      { userId, cleaned: cleanedCount, total: listenerKeys.length },
      "User listeners cleanup completed",
    );

    return { cleaned: cleanedCount, total: listenerKeys.length };
  }
}

export default RegistrationService;
