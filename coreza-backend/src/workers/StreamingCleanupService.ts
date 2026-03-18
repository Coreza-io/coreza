/**
 * StreamingCleanupService
 *
 * Periodically cleans up stale streaming workflow registrations
 * that haven't been active for a configurable period of time.
 */

import { getRedisCache } from "../config/redis";
import logger from "../utils/logger";

// Default stale threshold: 1 hour (in milliseconds)
const DEFAULT_STALE_THRESHOLD_MS = 60 * 60 * 1000;

// Cleanup interval: every 5 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

interface StreamingRegistration {
  userId: string;
  workflowId: string;
  nodeId: string;
  source: string;
  filterSymbols: string[];
  filterTypes: string[];
  subscriptionMode: string;
  registeredAt: string;
  lastActivityAt?: string;
}

class StreamingCleanupService {
  private cleanupInterval: NodeJS.Timeout | null = null;
  private staleThresholdMs: number;
  private isRunning: boolean = false;

  constructor(staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS) {
    this.staleThresholdMs = staleThresholdMs;
  }

  /**
   * Start the periodic cleanup job
   */
  start(): void {
    if (this.isRunning) {
      logger.warn("StreamingCleanupService is already running");
      return;
    }

    this.isRunning = true;
    logger.info(
      {
        intervalMs: CLEANUP_INTERVAL_MS,
        staleThresholdMs: this.staleThresholdMs,
      },
      "🧹 Starting StreamingCleanupService"
    );

    // Run immediately on start
    this.runCleanup().catch((err) => {
      logger.error({ err }, "Error in initial streaming cleanup");
    });

    // Schedule periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.runCleanup().catch((err) => {
        logger.error({ err }, "Error in periodic streaming cleanup");
      });
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop the cleanup job
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.isRunning = false;
    logger.info("🧹 StreamingCleanupService stopped");
  }

  /**
   * Run the cleanup process
   */
  async runCleanup(): Promise<{ cleaned: number; remaining: number }> {
    const redis = getRedisCache();
    const now = Date.now();
    let cleanedCount = 0;
    let remainingCount = 0;

    try {
      // Find all streaming workflow registrations (user-scoped pattern)
      const regKeys = await redis.keys("md:user:*:wf:reg:*");

      if (regKeys.length === 0) {
        logger.debug("No streaming registrations to clean up");
        return { cleaned: 0, remaining: 0 };
      }

      const workflowsToCleanup = new Map<
        string,
        { userId: string; nodeIds: string[] }
      >();

      for (const key of regKeys) {
        try {
          const data = await redis.get(key);
          if (!data) continue;

          const registration: StreamingRegistration = JSON.parse(data);

          // Determine last activity time
          const lastActivity = registration.lastActivityAt
            ? new Date(registration.lastActivityAt).getTime()
            : new Date(registration.registeredAt).getTime();

          const timeSinceActivity = now - lastActivity;

          if (timeSinceActivity > this.staleThresholdMs) {
            // Mark for cleanup
            const { workflowId, nodeId, userId } = registration;

            if (!workflowsToCleanup.has(workflowId)) {
              workflowsToCleanup.set(workflowId, { userId, nodeIds: [] });
            }
            workflowsToCleanup.get(workflowId)!.nodeIds.push(nodeId);

            // Delete the registration key
            await redis.del(key);
            cleanedCount++;

            logger.debug(
              { workflowId, nodeId, staleDurationMs: timeSinceActivity },
              "Cleaned up stale streaming registration"
            );
          } else {
            remainingCount++;
          }
        } catch (parseErr) {
          logger.warn(
            { key, err: parseErr },
            "Failed to parse registration data"
          );
        }
      }

      // Clean up workflow-level data for fully cleaned workflows
      for (const [workflowId, { userId, nodeIds }] of workflowsToCleanup) {
        // Check if any registrations remain for this workflow (user-scoped pattern)
        const remainingKeys = await redis.keys(`md:user:${userId}:wf:reg:${workflowId}`);

        if (remainingKeys.length === 0) {
          // No more registrations, clean up workflow-level data
          await redis.srem(
            `md:user:${userId}:active_streaming_workflows`,
            workflowId
          );
          await redis.del(`md:user:${userId}:workflow:${workflowId}:stream_filter`);

          logger.info(
            { workflowId, cleanedNodes: nodeIds.length },
            "🧹 Fully cleaned up stale streaming workflow"
          );
        }
      }

      if (cleanedCount > 0) {
        logger.info(
          { cleaned: cleanedCount, remaining: remainingCount },
          "🧹 Streaming cleanup completed"
        );
      }

      return { cleaned: cleanedCount, remaining: remainingCount };
    } catch (error) {
      logger.error({ err: error }, "Error during streaming cleanup");
      throw error;
    }
  }

  /**
   * Update last activity timestamp for a workflow registration
   */
  async updateActivity(userId: string, workflowId: string): Promise<void> {
    const redis = getRedisCache();
    // Use user-scoped key pattern: md:user:{userId}:wf:reg:{workflowId}
    const regKey = `md:user:${userId}:wf:reg:${workflowId}`;

    try {
      const data = await redis.get(regKey);
      if (!data) return;

      const registration: StreamingRegistration = JSON.parse(data);
      registration.lastActivityAt = new Date().toISOString();

      await redis.set(regKey, JSON.stringify(registration));
    } catch (error) {
      logger.warn(
        { userId, workflowId, err: error },
        "Failed to update streaming activity timestamp"
      );
    }
  }

  /**
   * Get cleanup statistics
   */
  getStats(): { isRunning: boolean; staleThresholdMs: number } {
    return {
      isRunning: this.isRunning,
      staleThresholdMs: this.staleThresholdMs,
    };
  }
}

// Singleton instance
const streamingCleanupService = new StreamingCleanupService();

export default streamingCleanupService;
export { StreamingCleanupService };
