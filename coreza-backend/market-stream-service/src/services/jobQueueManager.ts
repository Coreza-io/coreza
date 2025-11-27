import { Queue, Job } from "bullmq";
import { getRedis } from "../config/redis";
import { IWorkflowJobQueue, WorkflowJobData } from "./queueInterface";
import logger from "../utils/logger";
import { workflowExecutionsCounter } from "../utils/metrics";

const redis = getRedis();

// Queue instances
const workflowQueue = new Queue("workflow-execution", {
  connection: redis,
});

const scheduledQueue = new Queue("scheduled-workflows", {
  connection: redis,
});

// Queue management class (only adds jobs, does not execute them)
export class BullMQJobQueue implements IWorkflowJobQueue {
  async addWorkflowExecution(data: WorkflowJobData): Promise<Job> {
    try {
      logger.debug(
        { workflowId: data.workflowId, runId: data.runId, trigger: data.trigger },
        'Adding workflow execution to queue'
      );

      const job = await workflowQueue.add("execute-workflow", data, {
        removeOnComplete: 50,
        removeOnFail: 100,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
      });

      logger.info(
        { workflowId: data.workflowId, runId: data.runId, jobId: job.id },
        'Workflow execution queued successfully'
      );

      workflowExecutionsCounter.inc({ status: 'queued' });

      return job;
    } catch (error) {
      logger.error(
        { 
          err: error,
          workflowId: data.workflowId,
          runId: data.runId,
        },
        'Failed to add workflow execution to queue'
      );

      workflowExecutionsCounter.inc({ status: 'queue_error' });

      // Re-throw error so caller can handle it
      throw new Error(`Failed to queue workflow execution: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getQueueStats() {
    try {
      const [workflowStats, scheduledStats] = await Promise.all([
        workflowQueue.getJobCounts(),
        scheduledQueue.getJobCounts(),
      ]);

      return {
        workflow: workflowStats,
        scheduled: scheduledStats,
        mode: "bullmq",
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get queue stats');
      
      // Return empty stats instead of throwing
      return {
        workflow: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
        scheduled: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
        mode: "bullmq",
      };
    }
  }

  async cleanup(): Promise<void> {
    try {
      logger.info('Cleaning up queues...');
      
      await Promise.all([
        workflowQueue.close(),
        scheduledQueue.close(),
      ]);

      await redis.quit();
      
      logger.info('Queue cleanup completed successfully');
    } catch (error) {
      logger.error({ err: error }, 'Error during queue cleanup');
      throw error;
    }
  }
}

export const bullMqJobQueue = new BullMQJobQueue();

// Graceful shutdown
process.on("SIGINT", async () => {
  await bullMqJobQueue.cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await bullMqJobQueue.cleanup();
  process.exit(0);
});
