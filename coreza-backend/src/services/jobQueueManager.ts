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
import { getRedisQueue } from "../config/redis";
import {
  IWorkflowJobQueue,
  WorkflowJobData,
  ParallelLoopOptions,
} from "./queueInterface";
import { createWorkflowWorker } from "../utils/workflowWorker";
import { createScheduledWorkflowWorker } from "../utils/scheduledWorkflowWorker";
import { createSuccessOutput, createErrorOutput } from "../utils/normalizeOutput";
import {
  WorkflowJobResult,
  isWorkflowCancelled,
} from "../types/workflowJobResult";
import { LiveStrategyManager } from "./liveStrategyManager";
import { BacktestRunnerManager } from "./BacktestRunnerManager";
import { BacktestExecutor } from "../nodes/executors/BacktestExecutor";

const redis = getRedisQueue();
const WORKFLOW_JOB_ATTEMPTS = parseInt(
  process.env.WORKFLOW_JOB_ATTEMPTS || "1",
  10
);
// Queue instances
const workflowQueue = new Queue("workflow-execution", {
  connection: redis,
});
const scheduledQueue = new Queue("scheduled-workflows", {
  connection: redis,
});

// FlowProducer for parent-child job patterns (parallel loops)
const flowProducer = new FlowProducer({ connection: redis });

/**
 * Creates per-item parent store with Loop node output injected for current item.
 * This replaces pre-resolution - resolveReferences() will handle template resolution at runtime.
 */
function createItemParentStore(
  parentStoreData: Record<string, any>,
  loopId: string,
  item: any,
  itemIndex: number,
  totalItems: number
): Record<string, any> {
  return {
    ...parentStoreData,
    // Override Loop node's output with current item (not the full array)
    // This allows {{ $('Loop').json.data }} to resolve to current item during execution
    [loopId]: {
      data: {
        Item: [item],
        totalItem: totalItems,
        CurrentIndex: itemIndex,
        isLastIndex: itemIndex === totalItems - 1,
      },
      $loopContext: {
        itemIndex,
        totalItems,
        isFirstItem: itemIndex === 0,
        isLastItem: itemIndex === totalItems - 1,
      },
    },
  };
}

// Workflow execution worker
const workflowWorker = createWorkflowWorker({ redis, workflowQueue });

// Scheduled workflow worker
const scheduledWorker = createScheduledWorkflowWorker({
  redis,
  workflowQueue,
  workflowJobAttempts: WORKFLOW_JOB_ATTEMPTS,
});

// Queue management functions
export class BullMQJobQueue implements IWorkflowJobQueue {
  async addWorkflowExecution(data: WorkflowJobData): Promise<Job> {
    const jobId = `${data.userId}:${data.workflowId}:${data.runId}`;
    return await workflowQueue.add("execute-workflow", data, {
      jobId,
      removeOnComplete: 50,
      removeOnFail: 100,
      attempts: WORKFLOW_JOB_ATTEMPTS,
      backoff:
        WORKFLOW_JOB_ATTEMPTS > 1
          ? {
              type: "exponential",
              delay: 2000,
            }
          : undefined,
    });
  }

  /**
   * Creates parallel loop execution jobs using BullMQ FlowProducer.
   *
   * Architecture:
   * - Creates one parent aggregator job and N child jobs (one per loop item)
   * - Children execute in parallel across workers (limited by maxConcurrency)
   * - Parent waits for all children to complete via BullMQ dependency system
   * - Results are stored in Redis hash by itemIndex for ordered retrieval
   * - Supports continueOnError for fault-tolerant parallel processing
   *
   * @param parentRunId - The parent workflow run ID
   * @param loopId - The loop node ID
   * @param workflowId - The workflow ID
   * @param userId - The user ID
   * @param subgraphNodes - Nodes in the loop body subgraph
   * @param subgraphEdges - Edges in the loop body subgraph
   * @param items - Array of items to process in parallel
   * @param options - Parallel execution options (maxConcurrency, continueOnError)
   */
  async addParallelLoopExecution(
    parentRunId: string,
    loopId: string,
    workflowId: string,
    userId: string,
    subgraphNodes: any[],
    subgraphEdges: any[],
    items: any[],
    options: ParallelLoopOptions = {}
  ): Promise<void> {
    const {
      maxConcurrency = 10,
      continueOnError = false,
      useRedisStorage = true,
    } = options;

    console.log(
      `🔄 Creating ${items.length} parallel loop jobs for loop ${loopId} (maxConcurrency: ${maxConcurrency}, continueOnError: ${continueOnError})`
    );

    // Store loop metadata in Redis for continuation
    await redis.set(
      `loop:${parentRunId}:${loopId}:meta`,
      JSON.stringify({
        totalItems: items.length,
        maxConcurrency,
        continueOnError,
        startedAt: new Date().toISOString(),
      })
    );
    await redis.expire(`loop:${parentRunId}:${loopId}:meta`, 3600);

    // Find the first node(s) in the loop body - targets of edges from the Loop node's "loop" handle
    const loopBodyEntryEdges = subgraphEdges.filter(
      (e) =>
        e.source === loopId && (!e.sourceHandle || e.sourceHandle === "loop")
    );
    const startNodeId = loopBodyEntryEdges[0]?.target;

    if (!startNodeId) {
      console.warn(
        `⚠️ No entry node found for loop ${loopId} - loop body may be empty`
      );
    }

    // Create child jobs with rate limiting via delay
    // BullMQ will process up to `concurrency` jobs simultaneously
    // We add incremental delays to chunks beyond the first maxConcurrency items
    const childJobs = items.map((item, i) => {
      // Calculate delay to implement per-loop rate limiting
      const batchIndex = Math.floor(i / maxConcurrency);
      const delayMs = batchIndex > 0 ? batchIndex * 100 : 0; // 100ms between batches

      // Create per-item parent store with Loop node output as current item (not full array)
      // This allows resolveReferences() to handle ALL templates at runtime, including:
      // - {{ $('Loop').json.data }} → current item
      // - {{ $('RSI').json.result }} → upstream node output
      // - {{ $loopContext.itemIndex }} → loop context
      const itemParentStore = createItemParentStore(
        options.parentStoreData || {},
        loopId,
        item,
        i,
        items.length
      );

      return {
        name: `loop-item-${i}`,
        queueName: "workflow-execution",
        data: {
          runId: uuidv4(),
          workflowId,
          userId,
          nodes: subgraphNodes, // Original nodes - no pre-resolution needed
          edges: subgraphEdges,
          // All data accessible via $parentStore.Loop (data + $loopContext)
          // No redundant top-level fields needed
          initialInput: { $parentStore: itemParentStore },
          trigger: "loop_parallel",
          parentRunId,
          loopId,
          itemIndex: i,
          totalItems: items.length,
          useRedisStorage,
          continueOnError,
          startNodeId,
        } as WorkflowJobData,
        opts: {
          removeOnComplete: 50,
          removeOnFail: continueOnError ? 50 : 100,
          attempts: continueOnError ? 1 : WORKFLOW_JOB_ATTEMPTS,
          delay: delayMs,
          backoff:
            !continueOnError && WORKFLOW_JOB_ATTEMPTS > 1
              ? {
                  type: "exponential" as const,
                  delay: 2000,
                }
              : undefined,
          failParentOnFailure: !continueOnError,
        },
      };
    });

    console.log(
      `📦 Created ${items.length} child jobs with per-item store injection`
    );

    // Create the flow with parent aggregator and children
    await flowProducer.add({
      name: "loop-aggregator",
      queueName: "workflow-execution",
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
        continueOnError,
        // Include continuation metadata for done edge routing
        doneEdges: options.doneEdges || [],
        parentNodes: options.parentNodes || [],
        parentEdges: options.parentEdges || [],
      } as WorkflowJobData & {
        doneEdges: any[];
        parentNodes: any[];
        parentEdges: any[];
      },
      opts: {
        removeOnComplete: 50,
        removeOnFail: 100,
      },
      children: childJobs,
    });

    console.log(
      `✅ Created ${
        items.length
      } parallel loop jobs with aggregator (${Math.ceil(
        items.length / maxConcurrency
      )} batches)`
    );
  }


  async startLiveStrategy(
    workflowId: string,
    userId: string,
    nodes: any[],
    edges: any[]
  ): Promise<void> {
    const manager = LiveStrategyManager.getInstance();
    await manager.startStrategy(workflowId, userId, nodes, edges);
  }

  async stopLiveStrategy(workflowId: string): Promise<void> {
    const manager = LiveStrategyManager.getInstance();
    await manager.stopStrategy(workflowId);
  }



  async startBacktest(
    runId: string,
    workflowId: string,
    userId: string,
    nodes: any[],
    edges: any[],
    backtestInitNode: any,
  ): Promise<void> {
    const backtestExecutor = new BacktestExecutor();
    const context = { userId, workflowId, runId, nodes, edges };
    const input = backtestInitNode?.values || {};

    const result = await backtestExecutor.executeBacktestInit(
      backtestInitNode,
      input,
      context,
    );

    if (!result.success) {
      throw new Error(result.error || "Backtest initialization failed");
    }
  }

  async stopBacktest(backtestId: string): Promise<void> {
    const manager = BacktestRunnerManager.getInstance();
    await manager.stopBacktest(backtestId);
  }

  async scheduleWorkflow(
    workflowId: string,
    userId: string,
    cronExpression: string,
    timezone?: string
  ): Promise<Job> {
    const schedulerId = `${userId}:${workflowId}`;
    // Remove existing scheduled job
    await this.unscheduleWorkflow(schedulerId);

    // Add new scheduled job
    const job = await scheduledQueue.upsertJobScheduler(
      schedulerId, // scheduler ID
      {
        pattern: cronExpression,
        tz: timezone,
      },
      {
        name: "scheduled-workflow",
        data: {
          workflowId,
          userId,
          cronExpression,
          timezone,
        },
        opts: {
          attempts: WORKFLOW_JOB_ATTEMPTS,
          backoff:
            WORKFLOW_JOB_ATTEMPTS > 1
              ? {
                  type: "exponential",
                  delay: 2000,
                }
              : undefined,
          removeOnFail: true,
        },
      }
    );

    console.log(
      `📅 Registered scheduled workflow ${workflowId} (cron=${cronExpression}, timezone=${
        timezone ?? "UTC"
      }`
    );

    return job;
  }

  async unscheduleWorkflow(schedulerId: string): Promise<void> {
    console.log(`🗑 Removing scheduler for: ${schedulerId}`);
    const scheduledJobs = await scheduledQueue.getJobSchedulers();

    // Stop all future scheduled executions
    await scheduledQueue.removeJobScheduler(schedulerId);
  }

  async obliterateQueue(queueName: string): Promise<void> {
    console.log(`🗑️ Obliterating queue: ${queueName}`);
    const queue = new Queue(queueName, { connection: redis });
    await queue.obliterate({ force: true });
    await queue.close();
    console.log(`✅ Queue ${queueName} obliterated`);
  }

  /**
   * Cancel all queued/running jobs for a workflow.
   * - Uses native BullMQ worker.cancelJob() for active jobs (triggers AbortSignal immediately)
   * - Removes waiting/delayed jobs immediately
   * - Also cancels child jobs from parallel loops
   * - Returns count of jobs affected
   */
  async cancelWorkflowJobs(
    userId: string,
    workflowId: string
  ): Promise<number> {
    console.log(`🛑 Cancelling workflow ${workflowId}`);
    const schedulerId = `${userId}:${workflowId}`;

    // 1️⃣ Stop future scheduled executions
    await this.unscheduleWorkflow(schedulerId);

    // 2️⃣ Cancel queued & active execution jobs
    const jobs = await workflowQueue.getJobs(["waiting", "delayed", "active"]);

    let cancelledCount = 0;

    for (const job of jobs) {
      // Fix: Use OR (||) not AND (&&) - we want jobs matching userId OR workflowId
      if (job.data?.userId !== userId || job.data?.workflowId !== workflowId)
        continue;

      try {
        if (job.processedOn && !job.finishedOn) {
          // Active job - use BullMQ native cancellation
          // This triggers the AbortSignal in the worker IMMEDIATELY
          workflowWorker.cancelJob(job.id!, "Job cancelled by user");
          console.log(
            `🛑 Cancelled active job ${job.id} via BullMQ AbortSignal`
          );
          cancelledCount++;
        } else {
          // Waiting/delayed - remove from queue directly
          await job.remove();
          console.log(`🗑️ Removed waiting/delayed job ${job.id}`);
          cancelledCount++;
        }

        // Update run status in database
        if (job.data.runId) {
          await supabase
            .from("workflow_runs")
            .update({
              status: "cancelled",
              completed_at: new Date().toISOString(),
              error_message: "Workflow cancelled by user",
            })
            .eq("id", job.data.runId)
            .in("status", ["running", "queued"]);
        }
      } catch (err) {
        console.error(`Failed cancelling job ${job.id}`, err);
      }
    }

    const manager = LiveStrategyManager.getInstance();
    if (manager.isRunning(workflowId)) {
      await manager.stopStrategy(workflowId);
      cancelledCount++;
    }

    const backtestManager = BacktestRunnerManager.getInstance();
    const activeBacktests = await supabase
      .from("backtests")
      .select("id")
      .eq("workflow_id", workflowId)
      .eq("status", "running");

    for (const backtest of activeBacktests.data || []) {
      if (backtestManager.isRunning(backtest.id)) {
        await backtestManager.stopBacktest(backtest.id);
        cancelledCount++;
      }
    }

    console.log(
      `✅ Cancelled ${cancelledCount} jobs for workflow ${workflowId}`
    );
    return cancelledCount;
  }

  /**
   * Cancel a specific workflow run by runId.
   * Uses BullMQ native job cancellation for immediate AbortSignal triggering.
   */
  async cancelWorkflowRun(runId: string): Promise<boolean> {
    console.log(`🛑 Cancelling workflow run ${runId}`);

    const jobs = await workflowQueue.getJobs(["waiting", "delayed", "active"]);

    for (const job of jobs) {
      if (job.data?.runId === runId) {
        try {
          if (job.processedOn && !job.finishedOn) {
            // Active job - use BullMQ native cancellation
            await workflowWorker.cancelJob(job.id!);
            console.log(
              `🛑 Cancelled active run ${runId} via BullMQ AbortSignal`
            );
          } else {
            // Waiting/delayed - remove from queue
            await job.remove();
            console.log(`🗑️ Removed waiting/delayed run ${runId}`);
          }

          // Update run status in database
          await supabase
            .from("workflow_runs")
            .update({
              status: "cancelled",
              completed_at: new Date().toISOString(),
              error_message: "Run cancelled by user",
            })
            .eq("id", runId)
            .in("status", ["running", "queued"]);

          return true;
        } catch (err) {
          console.error(`Failed cancelling run ${runId}:`, err);
          return false;
        }
      }
    }

    console.log(`⚠️ Run ${runId} not found in queue`);
    return false;
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

  /**
   * Get workers for graceful shutdown handler.
   */
  getWorkers(): Worker[] {
    return [workflowWorker, scheduledWorker];
  }
}

// Event listeners for monitoring
workflowWorker.on("completed", (job, result: WorkflowJobResult) => {
  if (isWorkflowCancelled(result)) {
    console.log(`🛑 Workflow job ${job.id} cancelled: ${result.reason}`);
  } else {
    console.log(`✅ Workflow job ${job.id} completed`);
  }
});

workflowWorker.on("failed", (job, err) => {
  console.error(`❌ Workflow job ${job?.id} failed:`, err.message);
});

scheduledWorker.on("completed", (job) => {
  console.log(`⏰ Scheduled job ${job.id} completed`);
});

export const bullMqJobQueue = new BullMQJobQueue();

// Initialize graceful shutdown handler with workers
import { GracefulShutdownHandler } from "./GracefulShutdownHandler";

const gracefulShutdown = new GracefulShutdownHandler(
  bullMqJobQueue.getWorkers()
);

// Register signal handlers for graceful shutdown
gracefulShutdown.registerSignalHandlers(async () => {
  // Additional cleanup after workers are shut down
  await LiveStrategyManager.getInstance().stopAll();
  await redis.quit();
  console.log("✅ All queue resources cleaned up");
});
