import { Queue, Worker, Job } from "bullmq";
import { supabase } from "../config/supabase";
import { executeWorkflow } from "./workflowEngine";
import { WebSocketManager } from "./websocketManager";
import { getRedis } from "../config/redis";
import { IWorkflowJobQueue, WorkflowJobData } from "./queueInterface";

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

const redis = getRedis();

// Queue instances
const workflowQueue = new Queue("workflow-execution", {
  connection: redis,
});
const scheduledQueue = new Queue("scheduled-workflows", {
  connection: redis,
});

interface ScheduledWorkflowJobData {
  workflowId: string;
  userId: string;
  cronExpression: string;
}

// Workflow execution worker
const workflowWorker = new Worker(
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
        edges,
        { initialInput: job.data.initialInput }
      );

      // Save successful result to database
      await supabase
        .from("workflow_runs")
        .update({
          status: "success",
          result: result,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);

      console.log(`✅ Workflow run ${runId} completed successfully`);
      return result;
    } catch (error) {
      const normalized = normalizeError(error);
      console.error(
        `❌ Workflow execution failed for run ${runId}:`,
        normalized
      );

      // Save error to database
      await supabase
        .from("workflow_runs")
        .update({
          status: "failed",
          error_message: normalized.message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);

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
const scheduledWorker = new Worker(
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
      await workflowQueue.add("execute-workflow", {
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

// Queue management functions
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

  async scheduleWorkflow(
    workflowId: string,
    userId: string,
    cronExpression: string
  ): Promise<Job> {
    // Remove existing scheduled job
    await this.unscheduleWorkflow(workflowId);

    // Add new scheduled job
    return await scheduledQueue.add(
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
    const jobId = `scheduled-${workflowId}`;
    await scheduledQueue.removeRepeatable(jobId, { pattern: "*" });

    // Remove any existing jobs
    const jobs = await scheduledQueue.getJobs(["waiting", "delayed"]);
    for (const job of jobs) {
      if (job.id === jobId) {
        await job.remove();
      }
    }
  }

  async obliterateQueue(queueName: string): Promise<void> {
    console.log(`🗑️ Obliterating queue: ${queueName}`);
    const queue = new Queue(queueName, { connection: redis });
    await queue.obliterate({ force: true });
    await queue.close();
    console.log(`✅ Queue ${queueName} obliterated`);
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
    await Promise.all([workflowWorker.close(), scheduledWorker.close()]);

    await redis.quit();
    console.log("✅ Queue cleanup completed");
  }
}

// Event listeners for monitoring
workflowWorker.on("completed", (job) => {
  console.log(`✅ Workflow job ${job.id} completed`);
});

workflowWorker.on("failed", (job, err) => {
  console.error(`❌ Workflow job ${job?.id} failed:`, err.message);
});

scheduledWorker.on("completed", (job) => {
  console.log(`⏰ Scheduled job ${job.id} completed`);
});

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
