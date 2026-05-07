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

import { Queue } from "bullmq";
import { supabase } from "../config/supabase";
import { getRedisQueue, getRedisCache } from "../config/redis";
import logger from "../utils/logger";
import { RedisKeys } from "../infra/redisKeys";
import { workflowRecoveryCounter, staleRunsGauge } from "../utils/metrics";

export interface RecoveryStats {
  staleRunsFound: number;
  markedInterrupted: number;
  requeuedForRetry: number;
  alreadyCompleted: number;
  errors: number;
  orphanedLoopKeysCleanedUp: number;
}

interface StaleRun {
  id: string;
  workflow_id: string;
  status: string;
  started_at: string;
  job_id?: string;
}

export class WorkflowRecoveryService {
  private workflowQueue: Queue;
  private redis: ReturnType<typeof getRedisCache>;
  private staleThresholdMinutes: number;

  constructor(staleThresholdMinutes: number = 5) {
    this.workflowQueue = new Queue("workflow-execution", {
      connection: getRedisQueue(),
    });
    this.redis = getRedisCache();
    this.staleThresholdMinutes = staleThresholdMinutes;
  }

  /**
   * Recover stale workflow runs on startup.
   * Finds runs stuck in 'running' or 'queued' status older than threshold,
   * marks them as 'interrupted', and optionally re-queues for retry.
   */
  async recoverStaleRuns(): Promise<RecoveryStats> {
    const stats: RecoveryStats = {
      staleRunsFound: 0,
      markedInterrupted: 0,
      requeuedForRetry: 0,
      alreadyCompleted: 0,
      errors: 0,
      orphanedLoopKeysCleanedUp: 0,
    };

    try {
      logger.info(
        { thresholdMinutes: this.staleThresholdMinutes },
        "Starting stale workflow run recovery..."
      );

      // Find stale runs - status is running/queued and started_at is older than threshold
      const thresholdTime = new Date(
        Date.now() - this.staleThresholdMinutes * 60 * 1000
      ).toISOString();

      const { data: staleRuns, error } = await supabase
        .from("workflow_runs")
        .select("id, workflow_id, status, started_at")
        .in("status", ["running", "queued"])
        .lt("started_at", thresholdTime)
        .order("started_at", { ascending: true });

      if (error) {
        logger.error({ err: error }, "Failed to query stale runs");
        stats.errors++;
        return stats;
      }

      stats.staleRunsFound = staleRuns?.length || 0;
      staleRunsGauge.set(stats.staleRunsFound);

      if (!staleRuns || staleRuns.length === 0) {
        logger.info("No stale workflow runs found");
        return stats;
      }

      logger.info(
        { count: staleRuns.length },
        "Found stale workflow runs to recover"
      );

      // Process each stale run
      for (const run of staleRuns as StaleRun[]) {
        try {
          await this.recoverSingleRun(run, stats);
        } catch (err) {
          logger.error(
            { err, runId: run.id },
            "Failed to recover individual run"
          );
          stats.errors++;
        }
      }

      // Log recovery summary
      logger.info(
        {
          stats,
        },
        "Stale run recovery completed"
      );

      return stats;
    } catch (error) {
      logger.error({ err: error }, "Recovery process failed");
      stats.errors++;
      return stats;
    }
  }

  /**
   * Recover a single stale run.
   */
  private async recoverSingleRun(
    run: StaleRun,
    stats: RecoveryStats
  ): Promise<void> {
    const { id: runId, workflow_id: workflowId } = run;

    // Check if there's still a BullMQ job for this run
    const hasActiveJob = await this.checkActiveJob(runId);

    if (hasActiveJob) {
      logger.debug(
        { runId },
        "Run still has active job, skipping recovery"
      );
      stats.alreadyCompleted++;
      workflowRecoveryCounter.inc({ action: "already_active" });
      return;
    }

    // Check if workflow has auto_retry_on_failure enabled
    const shouldRetry = await this.checkAutoRetry(workflowId);

    if (shouldRetry) {
      // Re-queue the workflow for retry
      await this.requeue(run);
      stats.requeuedForRetry++;
      workflowRecoveryCounter.inc({ action: "requeued" });
      logger.info(
        { runId, workflowId },
        "Stale run re-queued for retry"
      );
    } else {
      // Mark as interrupted
      await this.markInterrupted(runId);
      stats.markedInterrupted++;
      workflowRecoveryCounter.inc({ action: "marked_interrupted" });
      logger.info({ runId, workflowId }, "Stale run marked as interrupted");
    }
  }

  /**
   * Check if there's still an active BullMQ job for this run.
   */
  private async checkActiveJob(runId: string): Promise<boolean> {
    try {
      // Search for active jobs with this runId
      const activeJobs = await this.workflowQueue.getJobs(["active"]);
      return activeJobs.some((job) => job.data?.runId === runId);
    } catch (error) {
      logger.warn(
        { err: error, runId },
        "Failed to check active jobs"
      );
      return false;
    }
  }

  /**
   * Check if workflow has auto_retry_on_failure enabled.
   */
  private async checkAutoRetry(workflowId: string): Promise<boolean> {
    try {
      const { data: workflow, error } = await supabase
        .from("workflows")
        .select("auto_retry_on_failure")
        .eq("id", workflowId)
        .single();

      if (error || !workflow) {
        return false;
      }

      return (workflow as any).auto_retry_on_failure === true;
    } catch {
      return false;
    }
  }

  /**
   * Mark a run as interrupted in the database.
   */
  private async markInterrupted(runId: string): Promise<void> {
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("workflow_runs")
      .update({
        status: "interrupted",
        error_message: "Workflow interrupted due to server restart",
        completed_at: now,
      })
      .eq("id", runId);

    if (error) {
      throw new Error(`Failed to mark run as interrupted: ${error.message}`);
    }
  }

  /**
   * Re-queue a stale run for retry.
   */
  private async requeue(run: StaleRun): Promise<void> {
    const { id: runId, workflow_id: workflowId } = run;

    // Get workflow details for re-execution
    const { data: workflow, error } = await supabase
      .from("workflows")
      .select("nodes, edges, user_id")
      .eq("id", workflowId)
      .single();

    if (error || !workflow) {
      throw new Error(`Failed to get workflow for requeue: ${error?.message}`);
    }

    // Mark current run as interrupted before creating new one
    await supabase
      .from("workflow_runs")
      .update({
        status: "interrupted",
        error_message: "Re-queued after server restart",
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);

    // Create new workflow run
    const { data: newRun, error: insertError } = await supabase
      .from("workflow_runs")
      .insert({
        workflow_id: workflowId,
        status: "queued",
        initiated_by: workflow.user_id,
        nodes: workflow.nodes,
        edges: workflow.edges,
        node_count: Array.isArray(workflow.nodes) ? workflow.nodes.length : 0,
        edge_count: Array.isArray(workflow.edges) ? workflow.edges.length : 0,
      })
      .select("id")
      .single();

    if (insertError || !newRun) {
      throw new Error(`Failed to create retry run: ${insertError?.message}`);
    }

    // Add to workflow queue
    await this.workflowQueue.add(
      "execute-workflow",
      {
        runId: newRun.id,
        workflowId,
        userId: workflow.user_id,
        nodes: workflow.nodes,
        edges: workflow.edges,
        trigger: "recovery_retry",
        executionMode: "manual",
      },
      {
        removeOnComplete: 50,
        removeOnFail: 100,
      }
    );

    logger.info(
      { originalRunId: runId, newRunId: newRun.id, workflowId },
      "Workflow re-queued for retry after recovery"
    );
  }

  /**
   * Clean up orphaned Redis keys from interrupted parallel loops.
   */
  async cleanupOrphanedLoopData(): Promise<number> {
    let cleanedCount = 0;

    try {
      const scanKeys = async (pattern: string): Promise<string[]> => {
        let cursor = "0";
        const allKeys: string[] = [];

        do {
          const [nextCursor, batch] = await this.redis.scan(
            cursor,
            "MATCH",
            pattern,
            "COUNT",
            200,
          );
          cursor = nextCursor;
          if (batch.length > 0) {
            allKeys.push(...batch);
          }
        } while (cursor !== "0");

        return allKeys;
      };

      // Find all user/workflow scoped loop metadata keys
      const keys = await scanKeys("loop:userId:*:workflowId:*:*:*:meta");

      for (const metaKey of keys) {
        // Extract key segments: loop:userId:{uid}:workflowId:{wid}:{parentRunId}:{loopId}:meta
        const parts = metaKey.split(":");
        if (parts.length < 8) continue;

        const userId = parts[2];
        const workflowId = parts[4];
        const parentRunId = parts[5];

        // Check if parent run is still active
        const { data: run, error } = await supabase
          .from("workflow_runs")
          .select("status")
          .eq("id", parentRunId)
          .single();

        // If run doesn't exist or is in terminal state, clean up
        if (error || !run || ["success", "failed", "cancelled", "interrupted"].includes(run.status)) {
          // Get all keys for this loop
          const loopPattern = RedisKeys.loopPattern(
            userId,
            workflowId,
            parentRunId,
          );
          const loopKeys = await scanKeys(loopPattern);

          if (loopKeys.length > 0) {
            await this.redis.del(...loopKeys);
            cleanedCount += loopKeys.length;
            logger.debug(
              { parentRunId, keysDeleted: loopKeys.length },
              "Cleaned up orphaned loop keys"
            );
          }
        }
      }

      if (cleanedCount > 0) {
        logger.info(
          { cleanedCount },
          "Orphaned loop data cleanup completed"
        );
      }

      return cleanedCount;
    } catch (error) {
      logger.error({ err: error }, "Failed to cleanup orphaned loop data");
      return cleanedCount;
    }
  }

  /**
   * Close resources.
   */
  async close(): Promise<void> {
    await this.workflowQueue.close();
  }
}

// Export singleton instance
export const workflowRecoveryService = new WorkflowRecoveryService(
  parseInt(process.env.STALE_RUN_THRESHOLD_MINUTES || "5", 10)
);
