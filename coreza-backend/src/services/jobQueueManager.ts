import { Queue, Worker, Job } from "bullmq";
import { supabase } from "../config/supabase";
import { executeWorkflow } from "./workflowEngine";
import { WebSocketManager } from "./websocketManager";
import { getRedis } from "../config/redis";
import { IWorkflowJobQueue, WorkflowJobData } from "./queueInterface";

const useBullMQQueue = process.env.USE_BULLMQ_QUEUE === "true";

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error("Unknown error");
  }
};

let redis = null as ReturnType<typeof getRedis> | null;
let workflowQueue: Queue<WorkflowJobData> | null = null;
let scheduledQueue: Queue<ScheduledWorkflowJobData> | null = null;
let workflowWorker: Worker<WorkflowJobData> | null = null;
let scheduledWorker: Worker<ScheduledWorkflowJobData> | null = null;
//export const agentQueue = new Queue('agent-processing', { connection: redis });
//export const notificationQueue = new Queue('notifications', { connection: redis });

interface ScheduledWorkflowJobData {
  workflowId: string;
  userId: string;
  cronExpression: string;
}

interface AgentJobData {
  sessionId: string;
  userId: string;
  input: string;
  context?: any;
}

interface NotificationJobData {
  userId: string;
  type: "email" | "sms" | "webhook" | "websocket";
  data: any;
}

if (useBullMQQueue) {
  redis = getRedis();

  // Queue instances
  workflowQueue = new Queue("workflow-execution", {
    connection: redis,
  });
  scheduledQueue = new Queue("scheduled-workflows", {
    connection: redis,
  });

  // Workflow execution worker
  workflowWorker = new Worker(
    "workflow-execution",
    async (job: Job<WorkflowJobData>) => {
      const { runId, nodes, edges, userId, workflowId } = job.data;

      console.log(`🚀 Processing workflow job ${job.id} for run ${runId}`);

      try {
        // Update run status to running
        await supabase
          .from("workflow_runs")
          .update({ status: "running" })
          .eq("id", runId);

        // Execute workflow using the unified engine
        const result = await executeWorkflow(
          runId,
          workflowId,
          userId,
          nodes,
          edges
        );

        // Send real-time update
        WebSocketManager.sendToUser(userId, {
          type: "workflow_completed",
          payload: {
            runId,
            success: result.success,
            result: result.result,
            error: result.error,
          },
        });

        return result;
      } catch (error) {
        const normalized = normalizeError(error);
        console.error(
          `❌ Workflow execution failed for run ${runId}:`,
          normalized
        );

        // Send real-time error update
        WebSocketManager.sendToUser(userId, {
          type: "workflow_failed",
          payload: {
            runId,
            error: normalized.message,
          },
        });

        throw normalized;
      }
    },
    {
      connection: redis,
      concurrency: parseInt(process.env.WORKFLOW_JOB_CONCURRENCY || "5"),
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 100 },
    }
  );

  // Scheduled workflow worker
  scheduledWorker = new Worker(
    "scheduled-workflows",
    async (job: Job<ScheduledWorkflowJobData>) => {
      const { workflowId, userId } = job.data;

      console.log(`⏰ Processing scheduled workflow ${workflowId}`);

      try {
        // Get workflow details
        const { data: workflow, error } = await supabase
          .from("workflows")
          .select("*")
          .eq("id", workflowId)
          .eq("is_active", true)
          .single();

        if (error || !workflow) {
          console.error(`Workflow ${workflowId} not found or not active`);
          return;
        }

        // Create workflow run
        const { data: run, error: runError } = await supabase
          .from("workflow_runs")
          .insert({
            workflow_id: workflowId,
            status: "queued",
            initiated_by: userId,
          })
          .select()
          .single();

        if (runError) {
          throw new Error(`Failed to create workflow run: ${runError.message}`);
        }

        // Queue workflow execution
        await workflowQueue!.add("execute-workflow", {
          runId: run.id,
          workflowId,
          userId,
          nodes: workflow.nodes,
          edges: workflow.edges,
          trigger: "scheduled",
        });

        return { runId: run.id };
      } catch (error) {
        const normalized = normalizeError(error);
        console.error(
          `❌ Scheduled workflow failed for ${workflowId}:`,
          normalized
        );
        throw normalized;
      }
    },
    {
      connection: redis,
      concurrency: 10,
    }
  );
} else {
  console.log("⚡ [QUEUE] BullMQ queue manager disabled - workers not started");
}

// // Agent processing worker
// const agentWorker = new Worker(
//   "agent-processing",
//   async (job: Job<AgentJobData>) => {
//     const { sessionId, userId, input, context } = job.data;

//     console.log(`🤖 Processing agent job for session ${sessionId}`);

//     try {
//       // This will be implemented with Langchain.js
//       const response = await processAgentRequest(input, context);

//       // Send real-time response
//       WebSocketManager.sendToUser(userId, {
//         type: "agent_response",
//         payload: {
//           sessionId,
//           response,
//         },
//       });

//       return response;
//     } catch (error) {
//       const normalized = normalizeError(error);
//       console.error(
//         `❌ Agent processing failed for session ${sessionId}:`,
//         normalized
//       );
//       throw normalized;
//     }
//   },
//   {
//     connection: redis,
//     concurrency: 3,
//   }
// );

// // Notification worker
// const notificationWorker = new Worker(
//   "notifications",
//   async (job: Job<NotificationJobData>) => {
//     const { userId, type, data } = job.data;

//     console.log(`📧 Processing notification for user ${userId}, type: ${type}`);

//     try {
//       switch (type) {
//         case "email":
//           await sendEmailNotification(data);
//           break;
//         case "sms":
//           await sendSMSNotification(data);
//           break;
//         case "webhook":
//           await sendWebhookNotification(data);
//           break;
//         case "websocket":
//           WebSocketManager.sendToUser(userId, data);
//           break;
//         default:
//           throw new Error(`Unknown notification type: ${type}`);
//       }

//       return { success: true };
//     } catch (error) {
//       const normalized = normalizeError(error);
//       console.error(`❌ Notification failed for user ${userId}:`, normalized);
//       throw normalized;
//     }
//   },
//   {
//     connection: redis,
//     concurrency: 20,
//   }
// );

// Queue management functions
export class BullMQJobQueue implements IWorkflowJobQueue {
  private assertQueues() {
    if (!workflowQueue || !scheduledQueue) {
      throw new Error(
        "BullMQ job queue is disabled. Set USE_BULLMQ_QUEUE=true to enable distributed processing."
      );
    }
  }

  async addWorkflowExecution(data: WorkflowJobData): Promise<Job> {
    this.assertQueues();
    return await workflowQueue!.add("execute-workflow", data, {
      removeOnComplete: 50,
      removeOnFail: 100,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
    });
  }

  async scheduleWorkflow(
    workflowId: string,
    userId: string,
    cronExpression: string
  ): Promise<Job> {
    this.assertQueues();
    // Remove existing scheduled job
    await this.unscheduleWorkflow(workflowId);

    // Add new scheduled job
    return await scheduledQueue!.add(
      `scheduled-${workflowId}`,
      { workflowId, userId, cronExpression },
      {
        repeat: { pattern: cronExpression },
        jobId: `scheduled-${workflowId}`,
        removeOnComplete: 10,
        removeOnFail: 50,
      }
    );
  }

  async unscheduleWorkflow(workflowId: string): Promise<void> {
    this.assertQueues();
    const jobId = `scheduled-${workflowId}`;
    await scheduledQueue!.removeRepeatable(jobId, { pattern: "*" });

    // Remove any existing jobs
    const jobs = await scheduledQueue!.getJobs(["waiting", "delayed"]);
    for (const job of jobs) {
      if (job.id === jobId) {
        await job.remove();
      }
    }
  }

  //static async addAgentProcessing(data: AgentJobData): Promise<Job> {
  //  return await agentQueue.add('process-agent', data, {
  //    removeOnComplete: 20,
  //    removeOnFail: 50,
  //    attempts: 2
  //  });
  //}

  //static async addNotification(data: NotificationJobData): Promise<Job> {
  //  return await notificationQueue.add('send-notification', data, {
  //    removeOnComplete: 100,
  //    removeOnFail: 50,
  //    attempts: 5,
  //    backoff: {
  //      type: 'exponential',
  //      delay: 1000,
  //    }
  //  });
  //}

  async getQueueStats() {
    this.assertQueues();
    const [workflowStats, scheduledStats] = await Promise.all([
      workflowQueue!.getJobCounts(),
      scheduledQueue!.getJobCounts(),
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
      workflowWorker?.close(),
      scheduledWorker?.close(),
    ]);

    await redis?.quit();
    console.log("✅ Queue cleanup completed");
  }
}

// Placeholder functions (to be implemented)
async function processAgentRequest(input: string, context: any): Promise<any> {
  // TODO: Implement with Langchain.js
  return { response: `Processed: ${input}`, context };
}

async function sendEmailNotification(data: any): Promise<void> {
  // TODO: Implement email sending
  console.log("📧 Email notification:", data);
}

async function sendSMSNotification(data: any): Promise<void> {
  // TODO: Implement SMS sending
  console.log("📱 SMS notification:", data);
}

async function sendWebhookNotification(data: any): Promise<void> {
  // TODO: Implement webhook sending
  console.log("🔗 Webhook notification:", data);
}

// Event listeners for monitoring
workflowWorker?.on("completed", (job) => {
  console.log(`✅ Workflow job ${job.id} completed`);
});

workflowWorker?.on("failed", (job, err) => {
  console.error(`❌ Workflow job ${job?.id} failed:`, err.message);
});

scheduledWorker?.on("completed", (job) => {
  console.log(`⏰ Scheduled job ${job.id} completed`);
});

export const bullMqJobQueue = new BullMQJobQueue();

// Graceful shutdown
if (process.env.USE_BULLMQ_QUEUE === "true") {
  process.on("SIGINT", async () => {
    await bullMqJobQueue.cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await bullMqJobQueue.cleanup();
    process.exit(0);
  });
}
