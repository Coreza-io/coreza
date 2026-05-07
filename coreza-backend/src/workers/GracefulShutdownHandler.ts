/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { Worker, Queue, FlowProducer } from "bullmq";
import { supabase } from "../config/supabase";
import { getRedisQueue } from "../config/redis";
import logger from "../utils/logger";
import { WorkflowRunnerManager } from "../services/workflowRunnerManager";
import { BacktestSessionManager } from "../backtest";
import { PortfolioManager } from "../simulation/PortfolioManager";

export interface ShutdownStats {
  activeJobsAtStart: number;
  jobsCompletedDuringDrain: number;
  jobsMarkedInterrupted: number;
  timeoutOccurred: boolean;
  totalDurationMs: number;
}

export class GracefulShutdownHandler {
  private isShuttingDown = false;
  private shutdownPromise: Promise<ShutdownStats> | null = null;
  private workers: Worker[] = [];
  private workflowQueue: Queue;
  private scheduledQueue: Queue;
  private flowProducer: FlowProducer;
  private timeoutMs: number;

  constructor(
    workers: Worker[],
    timeoutMs: number = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || "30000", 10)
  ) {
    this.workers = workers;
    this.timeoutMs = timeoutMs;
    const connection = getRedisQueue();
    this.workflowQueue = new Queue("workflow-execution", {
      connection: connection,
    });
    this.scheduledQueue = new Queue("scheduled-workflows", {
      connection: connection,
    });
    this.flowProducer = new FlowProducer({ connection: connection });
  }

  /**
   * Check if shutdown is in progress.
   */
  get shuttingDown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Initiate graceful shutdown.
   * - Pauses all workers (stop taking new jobs)
   * - Waits for active jobs to complete (with timeout)
   * - Marks remaining active jobs as interrupted
   * - Closes all workers
   */
  async initiateShutdown(): Promise<ShutdownStats> {
    // Prevent duplicate shutdown calls
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.isShuttingDown = true;
    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<ShutdownStats> {
    const startTime = Date.now();
    const stats: ShutdownStats = {
      activeJobsAtStart: 0,
      jobsCompletedDuringDrain: 0,
      jobsMarkedInterrupted: 0,
      timeoutOccurred: false,
      totalDurationMs: 0,
    };

    try {
      logger.info("🛑 Initiating graceful shutdown...");

      // 1. Pause all workers (stop taking new jobs)
      logger.info("⏸️ Pausing workers...");
      await Promise.all(this.workers.map((w) => w.pause()));
      logger.info("Workers paused");

      // 2. Get count of active jobs at start
      const activeJobs = await this.workflowQueue.getJobs(["active"]);
      stats.activeJobsAtStart = activeJobs.length;

      if (stats.activeJobsAtStart > 0) {
        logger.info(
          { activeJobs: stats.activeJobsAtStart },
          "Waiting for active jobs to complete..."
        );

        // 3. Wait for active jobs with timeout
        const completed = await this.waitForActiveJobs(activeJobs.length);
        stats.jobsCompletedDuringDrain = completed;
        stats.timeoutOccurred = completed < stats.activeJobsAtStart;

        if (stats.timeoutOccurred) {
          logger.warn(
            {
              completed,
              remaining: stats.activeJobsAtStart - completed,
            },
            "Shutdown timeout - marking remaining jobs as interrupted"
          );

          // 4. Mark remaining jobs as interrupted
          stats.jobsMarkedInterrupted =
            await this.markRemainingJobsInterrupted();
        }
      }

      // 5. Stop all long-lived strategy runners
      await WorkflowRunnerManager.getInstance().stopAll();
      await BacktestSessionManager.getInstance().stopAll();
      PortfolioManager.destroyAll();

      // 6. Close all workers
      logger.info("🔒 Closing workers...");
      await Promise.all(this.workers.map((w) => w.close()));
      logger.info("Workers closed");

      // Close producers
      await this.flowProducer.close();

      // 6. Close queue connection
      await this.workflowQueue.close();
      await this.scheduledQueue.close();

      stats.totalDurationMs = Date.now() - startTime;

      logger.info({ stats }, "✅ Graceful shutdown completed");

      return stats;
    } catch (error) {
      stats.totalDurationMs = Date.now() - startTime;
      logger.error({ err: error, stats }, "❌ Error during graceful shutdown");
      throw error;
    }
  }

  /**
   * Wait for active jobs to complete with timeout.
   * Returns the number of jobs that completed during the wait.
   */
  private async waitForActiveJobs(initialCount: number): Promise<number> {
    const startTime = Date.now();
    let previousCount = initialCount;
    let completedCount = 0;

    while (Date.now() - startTime < this.timeoutMs) {
      const activeJobs = await this.workflowQueue.getJobs(["active"]);
      const currentCount = activeJobs.length;

      // Calculate newly completed jobs
      if (currentCount < previousCount) {
        completedCount += previousCount - currentCount;
        previousCount = currentCount;
      }

      // All jobs completed
      if (currentCount === 0) {
        logger.info("All active jobs completed");
        return completedCount;
      }

      // Wait a bit before checking again
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Timeout occurred
    return completedCount;
  }

  /**
   * Mark remaining active jobs as interrupted in the database.
   */
  private async markRemainingJobsInterrupted(): Promise<number> {
    let markedCount = 0;

    try {
      const activeJobs = await this.workflowQueue.getJobs(["active"]);

      for (const job of activeJobs) {
        const runId = job.data?.runId;
        if (!runId) continue;

        try {
          const { error } = await supabase
            .from("workflow_runs")
            .update({
              status: "interrupted",
              error_message: "Workflow interrupted due to server shutdown",
              completed_at: new Date().toISOString(),
            })
            .eq("id", runId)
            .in("status", ["running", "queued"]);

          if (!error) {
            markedCount++;
            logger.debug(
              { runId, jobId: job.id },
              "Marked job as interrupted during shutdown"
            );
          }
        } catch (err) {
          logger.error({ err, runId }, "Failed to mark job as interrupted");
        }
      }

      return markedCount;
    } catch (error) {
      logger.error({ err: error }, "Failed to mark remaining jobs");
      return markedCount;
    }
  }

  /**
   * Register shutdown handlers for SIGINT and SIGTERM.
   * Returns a cleanup function to unregister the handlers.
   */
  registerSignalHandlers(additionalCleanup?: () => Promise<void>): () => void {
    const handler = async (signal: string) => {
      logger.info({ signal }, "Received shutdown signal");

      try {
        await this.initiateShutdown();

        if (additionalCleanup) {
          await additionalCleanup();
        }

        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, "Error during shutdown");
        process.exit(1);
      }
    };

    const sigintHandler = () => handler("SIGINT");
    const sigtermHandler = () => handler("SIGTERM");

    process.on("SIGINT", sigintHandler);
    process.on("SIGTERM", sigtermHandler);

    // Return cleanup function
    return () => {
      process.off("SIGINT", sigintHandler);
      process.off("SIGTERM", sigtermHandler);
    };
  }
}
