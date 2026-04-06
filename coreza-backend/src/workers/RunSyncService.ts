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
import { supabase } from "../config/supabase";
import logger from "../utils/logger";
import { RedisKeys } from "../infra/redisKeys";

/**
 * RunSyncService - Periodically syncs workflow runs from Redis to Supabase
 *
 * This service reduces database write load by:
 * 1. Storing workflow run metadata in Redis during high-frequency execution
 * 2. Batch syncing completed runs to Supabase every N seconds
 * 3. Cleaning up synced runs from Redis
 *
 * Pending lists are user-scoped: `userId:${userId}:runs:pending`
 * Active users are discovered from: `registry:users:runs:pending`
 * Data keys are user-scoped: `userId:${userId}:runId:${runId}`
 */
export class RunSyncService {
  private static instance: RunSyncService;
  private syncInterval: NodeJS.Timeout | null = null;
  private readonly SYNC_INTERVAL_MS = 10000; // 10 seconds
  private readonly BATCH_SIZE = 500;
  private isRunning = false;

  private constructor() {}

  static getInstance(): RunSyncService {
    if (!RunSyncService.instance) {
      RunSyncService.instance = new RunSyncService();
    }
    return RunSyncService.instance;
  }

  /**
   * Start the periodic sync service
   */
  start(): void {
    if (this.syncInterval) {
      logger.warn("RunSyncService already running");
      return;
    }

    logger.info(
      { intervalMs: this.SYNC_INTERVAL_MS },
      "Starting RunSyncService",
    );

    // Run immediately on start
    this.syncPendingRuns();

    // Then run periodically
    this.syncInterval = setInterval(() => {
      this.syncPendingRuns();
    }, this.SYNC_INTERVAL_MS);
  }

  /**
   * Stop the periodic sync service
   */
  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      logger.info("RunSyncService stopped");
    }
  }

  /**
   * Sync pending runs from Redis to Supabase
   */
  async syncPendingRuns(): Promise<void> {
    if (this.isRunning) {
      logger.debug("Sync already in progress, skipping");
      return;
    }

    this.isRunning = true;
    const redis = getRedisCache();

    try {
      const activeUsers = await redis.smembers(RedisKeys.registryRunsPending());
      if (activeUsers.length === 0) {
        return;
      }

      logger.debug({ count: activeUsers.length }, "Processing users with pending runs");

      // Fetch run data for each active user's pending queue
      const parsedEntries: Array<{ userId: string; runId: string }> = [];
      const fetchPipeline = redis.pipeline();

      for (const userId of activeUsers) {
        const pendingEntries = await redis.lrange(
          RedisKeys.userRunsPending(userId),
          0,
          this.BATCH_SIZE - 1,
        );

        if (pendingEntries.length === 0) {
          await redis.srem(RedisKeys.registryRunsPending(), userId);
          continue;
        }

        for (const runId of pendingEntries) {
          parsedEntries.push({ userId, runId });
          fetchPipeline.hgetall(RedisKeys.userRun(userId, runId));
        }
      }

      if (parsedEntries.length === 0) {
        return;
      }

      const results = await fetchPipeline.exec();
      if (!results) {
        return;
      }

      const runs: Array<{
        id: string;
        workflow_id: string;
        initiated_by: string;
        status: string;
        started_at: string;
        completed_at?: string;
        result?: string;
        error_message?: string;
        nodes?: string;
        edges?: string;
        node_count?: string;
        edge_count?: string;
        session_id?: string;
      }> = [];

      for (let i = 0; i < parsedEntries.length; i++) {
        const [err, runData] = results[i];
        if (err || !runData || !(runData as Record<string, string>).id) {
          continue;
        }

        const data = runData as Record<string, string>;
        runs.push({
          id: data.id,
          workflow_id: data.workflow_id,
          initiated_by: data.initiated_by,
          status: data.status,
          started_at: data.started_at,
          completed_at: data.completed_at,
          result: data.result,
          error_message: data.error_message,
          nodes: data.nodes,
          edges: data.edges,
          node_count: data.node_count,
          edge_count: data.edge_count,
          session_id: data.session_id,
        });
      }

      // Filter to only completed runs (success, failed, or cancelled)
      const completedRuns = runs.filter(
        (r) =>
          r.status === "success" ||
          r.status === "failed" ||
          r.status === "cancelled",
      );

      if (completedRuns.length === 0) {
        return;
      }

      // Parse result JSON strings and prepare for insert
      const runsToInsert = completedRuns.map((run) => ({
        id: run.id,
        workflow_id: run.workflow_id,
        initiated_by: run.initiated_by,
        status: run.status,
        started_at: run.started_at,
        completed_at: run.completed_at || new Date().toISOString(),
        result: run.result ? JSON.parse(run.result) : null,
        error_message: run.error_message || null,
        ...(run.nodes ? { nodes: JSON.parse(run.nodes) } : {}),
        ...(run.edges ? { edges: JSON.parse(run.edges) } : {}),
        ...(run.node_count ? { node_count: parseInt(run.node_count, 10) } : {}),
        ...(run.edge_count ? { edge_count: parseInt(run.edge_count, 10) } : {}),
        ...(run.session_id ? { session_id: run.session_id } : {}),
      }));

      // Batch upsert to Supabase
      const { error } = await supabase
        .from("workflow_runs")
        .upsert(runsToInsert, { onConflict: "id" });

      if (error) {
        logger.error(
          { err: error, count: runsToInsert.length },
          "Failed to sync runs to Supabase",
        );
        return;
      }

      logger.info(
        { count: completedRuns.length },
        "Synced workflow runs to Supabase",
      );

      // Remove synced runs from Redis using initiated_by for user-scoped keys
      const cleanupPipeline = redis.pipeline();
      const touchedUsers = new Set<string>();
      for (const run of completedRuns) {
        cleanupPipeline.del(RedisKeys.userRun(run.initiated_by, run.id));
        cleanupPipeline.lrem(
          RedisKeys.userRunsPending(run.initiated_by),
          1,
          run.id,
        );
        touchedUsers.add(run.initiated_by);
      }

      for (const userId of touchedUsers) {
        cleanupPipeline.llen(RedisKeys.userRunsPending(userId));
      }
      const cleanupResults = await cleanupPipeline.exec();

      if (cleanupResults) {
        let index = completedRuns.length * 2;
        for (const userId of touchedUsers) {
          const [lenErr, lenRaw] = cleanupResults[index] ?? [];
          const pendingLen = lenErr ? null : Number(lenRaw ?? 0);
          if (pendingLen === 0) {
            await redis.srem(RedisKeys.registryRunsPending(), userId);
          }
          index += 1;
        }
      }

      logger.debug(
        { count: completedRuns.length },
        "Cleaned up synced runs from Redis",
      );
    } catch (error) {
      logger.error({ err: error }, "RunSyncService error during sync");
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Force sync all pending runs (useful for shutdown)
   */
  async flushAll(): Promise<void> {
    logger.info("Flushing all pending runs to Supabase...");

    let hasMore = true;
    while (hasMore) {
      const redis = getRedisCache();
      const activeUsers = await redis.smembers(RedisKeys.registryRunsPending());
      let count = 0;
      for (const userId of activeUsers) {
        count += await redis.llen(RedisKeys.userRunsPending(userId));
      }
      if (count === 0) {
        hasMore = false;
      } else {
        await this.syncPendingRuns();
      }
    }

    logger.info("All pending runs flushed");
  }

  /**
   * Get stats about pending runs
   */
  async getStats(): Promise<{ pendingCount: number }> {
    const redis = getRedisCache();
    const activeUsers = await redis.smembers(RedisKeys.registryRunsPending());
    let pendingCount = 0;
    for (const userId of activeUsers) {
      pendingCount += await redis.llen(RedisKeys.userRunsPending(userId));
    }
    return { pendingCount };
  }
}

export default RunSyncService.getInstance();
