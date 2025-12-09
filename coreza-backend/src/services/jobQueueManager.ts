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

import { Queue, Worker, Job, FlowProducer } from "bullmq";
import { v4 as uuidv4 } from "uuid";
import { supabase } from "../config/supabase";
import { executeWorkflow } from "./workflowEngine";
import { getRedisQueue } from "../config/redis";
import { IWorkflowJobQueue, WorkflowJobData } from "./queueInterface";
import { updateRunStatusInRedis } from "../utils/redisRunStorage";

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

const redis = getRedisQueue();

// Queue instances
const workflowQueue = new Queue("workflow-execution", {
  connection: redis,
});
const scheduledQueue = new Queue("scheduled-workflows", {
  connection: redis,
});

// FlowProducer for parent-child job patterns (parallel loops)
const flowProducer = new FlowProducer({ connection: redis });

interface ScheduledWorkflowJobData {
  workflowId: string;
  userId: string;
  cronExpression: string;
}

// Workflow execution worker
const workflowWorker = new Worker(
  "workflow-execution",
  async (job: Job<WorkflowJobData>) => {
    const { 
      runId, 
      nodes, 
      edges, 
      userId, 
      workflowId, 
      useRedisStorage,
      trigger,
      isLoopAggregator,
      parentRunId,
      loopId,
      itemIndex,
      totalItems
    } = job.data;

    // Handle parallel loop item execution
    if (trigger === 'loop_parallel' && !isLoopAggregator) {
      console.log(`🔄 Processing loop item ${(itemIndex ?? 0) + 1}/${totalItems} for loop ${loopId}`);
      
      try {
        const result = await executeWorkflow(
          runId,
          workflowId,
          userId,
          nodes,
          edges,
          { initialInput: job.data.initialInput }
        );

        // Store result in Redis by itemIndex for ordered aggregation
        const key = `loop:${parentRunId}:${loopId}:results`;
        await redis.hset(key, String(itemIndex), JSON.stringify(result));
        await redis.expire(key, 3600); // 1 hour TTL

        console.log(`✅ Loop item ${(itemIndex ?? 0) + 1}/${totalItems} completed`);
        return result;
      } catch (error) {
        const normalized = normalizeError(error);
        console.error(`❌ Loop item ${(itemIndex ?? 0) + 1}/${totalItems} failed:`, normalized.message);
        
        // Store error in Redis for aggregation
        const key = `loop:${parentRunId}:${loopId}:results`;
        await redis.hset(key, String(itemIndex), JSON.stringify({ error: normalized.message }));
        await redis.expire(key, 3600);
        
        throw normalized;
      }
    }

    // Handle aggregator (parent job that waits for all children)
    if (isLoopAggregator) {
      console.log(`📊 Aggregating ${totalItems} parallel loop results for loop ${loopId}`);

      try {
        // BullMQ automatically waits for all children via getChildrenValues()
        const childrenValues = await job.getChildrenValues();
        
        // Order results by itemIndex (children come back in completion order, not index order)
        const orderedResults: any[] = [];
        for (let i = 0; i < (totalItems ?? 0); i++) {
          // Find the child result for this index
          const childKey = Object.keys(childrenValues).find(k => k.includes(`loop-item-${i}`));
          if (childKey) {
            orderedResults.push(childrenValues[childKey]);
          }
        }

        // Store aggregated results for parent workflow to retrieve
        const aggregatedKey = `loop:${parentRunId}:${loopId}:aggregated`;
        await redis.set(aggregatedKey, JSON.stringify(orderedResults));
        await redis.expire(aggregatedKey, 3600);

        // Signal completion via Redis pub/sub
        await redis.publish('loop:completed', JSON.stringify({
          parentRunId,
          loopId,
          resultCount: orderedResults.length,
        }));

        console.log(`✅ Aggregated ${orderedResults.length} loop results for loop ${loopId}`);
        return { aggregated: orderedResults, count: orderedResults.length };
      } catch (error) {
        const normalized = normalizeError(error);
        console.error(`❌ Loop aggregation failed for ${loopId}:`, normalized.message);
        throw normalized;
      }
    }

    // Normal workflow execution
    console.log(`🚀 Processing workflow job ${job.id} for run ${runId} (Redis storage: ${useRedisStorage})`);

    try {
      // Update run status to running
      if (useRedisStorage) {
        await updateRunStatusInRedis(runId, 'running');
      } else {
        await supabase
          .from("workflow_runs")
          .update({ status: "running" })
          .eq("id", runId);
      }

      // Execute workflow using the unified engine
      const input = job.data.initialInput;
      const renamed = {
        data: input?.marketEvent ?? input?.data ?? input,
      };
      const result = await executeWorkflow(
        runId,
        workflowId,
        userId,
        nodes,
        edges,
        { initialInput: renamed }
      );

      // Save successful result
      if (useRedisStorage) {
        await updateRunStatusInRedis(runId, 'success', { result });
      } else {
        await supabase
          .from("workflow_runs")
          .update({
            status: "success",
            result: result,
            completed_at: new Date().toISOString(),
          })
          .eq("id", runId);
      }

      console.log(`✅ Workflow run ${runId} completed successfully`);
      return result;
    } catch (error) {
      const normalized = normalizeError(error);
      console.error(
        `❌ Workflow execution failed for run ${runId}:`,
        normalized
      );

      // Save error
      if (useRedisStorage) {
        await updateRunStatusInRedis(runId, 'failed', { errorMessage: normalized.message });
      } else {
        await supabase
          .from("workflow_runs")
          .update({
            status: "failed",
            error_message: normalized.message,
            completed_at: new Date().toISOString(),
          })
          .eq("id", runId);
      }

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

  /**
   * Creates parallel loop execution jobs using BullMQ FlowProducer.
   * Creates one parent aggregator job and N child jobs (one per loop item).
   * Children execute in parallel across workers, parent waits for all children.
   */
  async addParallelLoopExecution(
    parentRunId: string,
    loopId: string,
    workflowId: string,
    userId: string,
    subgraphNodes: any[],
    subgraphEdges: any[],
    items: any[],
    useRedisStorage: boolean = true
  ): Promise<void> {
    console.log(`🔄 Creating ${items.length} parallel loop jobs for loop ${loopId}`);

    await flowProducer.add({
      name: 'loop-aggregator',
      queueName: 'workflow-execution',
      data: {
        isLoopAggregator: true,
        parentRunId,
        loopId,
        workflowId,
        userId,
        totalItems: items.length,
        useRedisStorage,
        runId: parentRunId,
        nodes: [],
        edges: [],
      } as WorkflowJobData,
      opts: {
        removeOnComplete: 50,
        removeOnFail: 100,
      },
      children: items.map((item, i) => ({
        name: `loop-item-${i}`,
        queueName: 'workflow-execution',
        data: {
          runId: uuidv4(),
          workflowId,
          userId,
          nodes: subgraphNodes,
          edges: subgraphEdges,
          initialInput: {
            data: item,
            $loopContext: {
              itemIndex: i,
              totalItems: items.length,
              isFirstItem: i === 0,
              isLastItem: i === items.length - 1,
            },
          },
          trigger: 'loop_parallel',
          parentRunId,
          loopId,
          itemIndex: i,
          totalItems: items.length,
          useRedisStorage,
        } as WorkflowJobData,
        opts: {
          removeOnComplete: 50,
          removeOnFail: 100,
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 2000,
          },
        },
      })),
    });

    console.log(`✅ Created ${items.length} parallel loop jobs with aggregator`);
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
    await Promise.all([
      workflowWorker.close(), 
      scheduledWorker.close(),
      flowProducer.close(),
    ]);

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
