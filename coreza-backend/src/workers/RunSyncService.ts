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

import { getRedisCache } from '../config/redis';
import { supabase } from '../config/supabase';
import logger from '../utils/logger';

/**
 * RunSyncService - Periodically syncs workflow runs from Redis to Supabase
 * 
 * This service reduces database write load by:
 * 1. Storing workflow run metadata in Redis during high-frequency execution
 * 2. Batch syncing completed runs to Supabase every N seconds
 * 3. Cleaning up synced runs from Redis
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
      logger.warn('RunSyncService already running');
      return;
    }

    logger.info({ intervalMs: this.SYNC_INTERVAL_MS }, 'Starting RunSyncService');
    
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
      logger.info('RunSyncService stopped');
    }
  }

  /**
   * Sync pending runs from Redis to Supabase
   */
  async syncPendingRuns(): Promise<void> {
    if (this.isRunning) {
      logger.debug('Sync already in progress, skipping');
      return;
    }

    this.isRunning = true;
    const redis = getRedisCache();

    try {
      // Get pending run IDs from Redis list
      const pendingRunIds = await redis.lrange('runs:pending:all', 0, this.BATCH_SIZE - 1);
      
      if (pendingRunIds.length === 0) {
        return;
      }

      logger.debug({ count: pendingRunIds.length }, 'Processing pending runs');

      // Fetch run data from Redis
      const runs: Array<{
        id: string;
        workflow_id: string;
        initiated_by: string;
        status: string;
        started_at: string;
        completed_at?: string;
        result?: string;
        error_message?: string;
      }> = [];

      for (const runId of pendingRunIds) {
        const runData = await redis.hgetall(`runs:data:${runId}`);
        if (runData && runData.id) {
          runs.push({
            id: runData.id,
            workflow_id: runData.workflow_id,
            initiated_by: runData.initiated_by,
            status: runData.status,
            started_at: runData.started_at,
            completed_at: runData.completed_at,
            result: runData.result,
            error_message: runData.error_message,
          });
        }
      }

      // Filter to only completed runs (success, failed, or cancelled)
      const completedRuns = runs.filter(
        r => r.status === 'success' || r.status === 'failed' || r.status === 'cancelled'
      );

      if (completedRuns.length === 0) {
        return;
      }

      // Parse result JSON strings and prepare for insert
      const runsToInsert = completedRuns.map(run => ({
        id: run.id,
        workflow_id: run.workflow_id,
        initiated_by: run.initiated_by,
        status: run.status,
        started_at: run.started_at,
        completed_at: run.completed_at || new Date().toISOString(),
        result: run.result ? JSON.parse(run.result) : null,
        error_message: run.error_message || null,
      }));

      // Batch upsert to Supabase (upsert in case some runs already exist)
      const { error } = await supabase
        .from('workflow_runs')
        .upsert(runsToInsert, { onConflict: 'id' });

      if (error) {
        logger.error({ err: error, count: runsToInsert.length }, 'Failed to sync runs to Supabase');
        return;
      }

      logger.info({ count: completedRuns.length }, 'Synced workflow runs to Supabase');

      // Remove synced runs from Redis
      const pipeline = redis.pipeline();
      for (const run of completedRuns) {
        pipeline.del(`runs:data:${run.id}`);
        pipeline.lrem('runs:pending:all', 1, run.id);
      }
      await pipeline.exec();

      logger.debug({ count: completedRuns.length }, 'Cleaned up synced runs from Redis');

    } catch (error) {
      logger.error({ err: error }, 'RunSyncService error during sync');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Force sync all pending runs (useful for shutdown)
   */
  async flushAll(): Promise<void> {
    logger.info('Flushing all pending runs to Supabase...');
    
    // Keep syncing until no more pending runs
    let hasMore = true;
    while (hasMore) {
      const redis = getRedisCache();
      const count = await redis.llen('runs:pending:all');
      if (count === 0) {
        hasMore = false;
      } else {
        await this.syncPendingRuns();
      }
    }
    
    logger.info('All pending runs flushed');
  }

  /**
   * Get stats about pending runs
   */
  async getStats(): Promise<{ pendingCount: number }> {
    const redis = getRedisCache();
    const pendingCount = await redis.llen('runs:pending:all');
    return { pendingCount };
  }
}

export default RunSyncService.getInstance();
