import { Queue, Job } from "bullmq";
import { getRedis } from "../config/redis";
import { IWorkflowJobQueue, WorkflowJobData } from "./queueInterface";

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
    return await workflowQueue.add("execute-workflow", data, {
      removeOnComplete: 50,
      removeOnFail: 100,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
    });
  }

  async getQueueStats() {
    const [workflowStats, scheduledStats] = await Promise.all([
      workflowQueue.getJobCounts(),
      scheduledQueue.getJobCounts(),
    ]);

    return {
      workflow: workflowStats,
      scheduled: scheduledStats,
      mode: "bullmq",
    };
  }

  async cleanup(): Promise<void> {
    console.log("🧹 Cleaning up queues...");
    await Promise.all([
      workflowQueue.close(),
      scheduledQueue.close(),
    ]);

    await redis.quit();
    console.log("✅ Queue cleanup completed");
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
