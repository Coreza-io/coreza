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
import {
  IWorkflowJobQueue,
  WorkflowJobData,
  ParallelLoopOptions,
} from "./queueInterface";
import { updateRunStatusInRedis } from "../utils/redisRunStorage";
import { initializeNodeExecutors, getAllRegisteredCategories } from "../nodes";
import {
  createSuccessOutput,
  createErrorOutput,
} from "../utils/normalizeOutput";
import { StandardNodeOutput } from "../types/nodeOutput";
import {
  WorkflowJobResult,
  LoopItemResult,
  isWorkflowCancelled,
} from "../types/workflowJobResult";

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

interface ScheduledWorkflowJobData {
  workflowId: string;
  userId: string;
  cronExpression: string;
  timezone?: string;
}

// LoopItemResult is now imported from ../types/workflowJobResult

/**
 * Collects and orders results from Redis hash by itemIndex.
 * Handles both successful and failed items gracefully.
 */
async function collectOrderedResults(
  parentRunId: string,
  loopId: string,
  totalItems: number,
  continueOnError: boolean
): Promise<{
  results: LoopItemResult[];
  hasErrors: boolean;
  errorCount: number;
}> {
  const key = `loop:${parentRunId}:${loopId}:results`;
  const resultsHash = await redis.hgetall(key);

  const results: LoopItemResult[] = new Array(totalItems);
  let hasErrors = false;
  let errorCount = 0;

  for (let i = 0; i < totalItems; i++) {
    const rawValue = resultsHash[String(i)];
    if (rawValue) {
      try {
        const parsed = JSON.parse(rawValue);
        if (parsed.error || parsed.success === false) {
          hasErrors = true;
          errorCount++;
          const errorOutput = createErrorOutput(
            parsed.error || "Unknown error",
            {
              nodeName: `loop-item-${i}`,
              category: "loop",
            }
          );
          results[i] = { ...errorOutput, itemIndex: i };
        } else {
          const successOutput = createSuccessOutput(parsed.data ?? parsed, {
            nodeName: `loop-item-${i}`,
            category: "loop",
          });
          results[i] = { ...successOutput, itemIndex: i };
        }
      } catch {
        hasErrors = true;
        errorCount++;
        const errorOutput = createErrorOutput("Failed to parse result", {
          nodeName: `loop-item-${i}`,
          category: "loop",
        });
        results[i] = { ...errorOutput, itemIndex: i };
      }
    } else {
      // Missing result - treat as error
      hasErrors = true;
      errorCount++;
      const errorOutput = createErrorOutput("No result received", {
        nodeName: `loop-item-${i}`,
        category: "loop",
      });
      results[i] = { ...errorOutput, itemIndex: i };
    }
  }

  return { results, hasErrors, errorCount };
}

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
      data: item,
      $loopContext: {
        itemIndex,
        totalItems,
        isFirstItem: itemIndex === 0,
        isLastItem: itemIndex === totalItems - 1,
      },
    },
  };
}

/**
 * Cleans up Redis keys after loop aggregation completes.
 */
async function cleanupLoopKeys(
  parentRunId: string,
  loopId: string
): Promise<void> {
  const keysToDelete = [
    `loop:${parentRunId}:${loopId}:results`,
    `loop:${parentRunId}:${loopId}:aggregated`,
    `loop:${parentRunId}:${loopId}:meta`,
  ];

  await Promise.all(keysToDelete.map((key) => redis.del(key)));
  console.log(`🧹 Cleaned up Redis keys for loop ${loopId}`);
}

// Workflow execution worker
const workflowWorker = new Worker<WorkflowJobData, WorkflowJobResult>(
  "workflow-execution",
  async (
    job: Job<WorkflowJobData>,
    token?: string,
    signal?: AbortSignal
  ): Promise<WorkflowJobResult> => {
    // Ensure node executors are registered (handles circular dependency race condition)
    const registeredCategories = getAllRegisteredCategories();
    if (registeredCategories.length === 0) {
      console.log("🔧 Initializing node executors from worker...");
      initializeNodeExecutors();
    }

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
      totalItems,
      continueOnError = false,
    } = job.data;

    // Handle parallel loop item execution
    if (trigger === "loop_parallel" && !isLoopAggregator) {
      console.log(
        `🔄 Processing loop item ${
          (itemIndex ?? 0) + 1
        }/${totalItems} for loop ${loopId}`
      );

      const startNodeId = (job.data as any).startNodeId;
      console.log(
        `🎯 Loop item starting from node: ${startNodeId || "auto-detect"}`
      );

      try {
        const result = await executeWorkflow(
          runId,
          workflowId,
          userId,
          nodes,
          edges,
          {
            initialInput: job.data.initialInput,
            startNodeId, // Pass entry point to workflow engine
            abortSignal: signal, // Pass abort signal from BullMQ for cancellation
          }
        );

        // Store successful result in Redis by itemIndex
        const key = `loop:${parentRunId}:${loopId}:results`;
        await redis.hset(key, String(itemIndex), JSON.stringify(result));
        await redis.expire(key, 3600); // 1 hour TTL

        console.log(
          `✅ Loop item ${(itemIndex ?? 0) + 1}/${totalItems} completed`
        );
        const successOutput = createSuccessOutput(result, {
          nodeName: `loop-item-${itemIndex}`,
          category: "loop",
        });
        return { ...successOutput, itemIndex };
      } catch (error) {
        const errorOutput = createErrorOutput(error, {
          nodeName: `loop-item-${itemIndex}`,
          category: "loop",
        });
        console.error(
          `❌ Loop item ${(itemIndex ?? 0) + 1}/${totalItems} failed:`,
          errorOutput.error
        );

        // Store error in Redis for aggregation (allows continueOnError)
        const key = `loop:${parentRunId}:${loopId}:results`;
        await redis.hset(key, String(itemIndex), JSON.stringify(errorOutput));
        await redis.expire(key, 3600);

        // If continueOnError is false, throw to fail the job
        if (!continueOnError) {
          throw new Error(errorOutput.error);
        }

        // Return error result for aggregation
        return { ...errorOutput, itemIndex };
      }
    }

    // Handle aggregator (parent job that waits for all children)
    if (isLoopAggregator) {
      console.log(
        `📊 Aggregating ${totalItems} parallel loop results for loop ${loopId}`
      );

      // Extract continuation metadata
      const doneEdges = (job.data as any).doneEdges || [];
      const parentNodes = (job.data as any).parentNodes || [];
      const parentEdges = (job.data as any).parentEdges || [];

      try {
        // Collect ordered results from Redis hash (more reliable than getChildrenValues)
        const { results, hasErrors, errorCount } = await collectOrderedResults(
          parentRunId!,
          loopId!,
          totalItems ?? 0,
          continueOnError
        );

        // Keep full StandardNodeOutput for each item, preserving structure
        const aggregatedOutput = results.map((r) => ({
          success: r.success,
          status: r.status,
          data: r.data,
          error: r.error,
          itemIndex: r.itemIndex,
          meta: r.meta,
        }));

        // Store aggregated results for parent workflow to retrieve
        const aggregatedKey = `loop:${parentRunId}:${loopId}:aggregated`;
        await redis.set(
          aggregatedKey,
          JSON.stringify({
            results: aggregatedOutput,
            meta: {
              totalItems,
              successCount: totalItems! - errorCount,
              errorCount,
              hasErrors,
              completedAt: new Date().toISOString(),
            },
          })
        );
        await redis.expire(aggregatedKey, 3600);

        console.log(
          `✅ Aggregated ${results.length} loop results (${errorCount} errors) for loop ${loopId}`
        );

        // Queue continuation jobs for done edges (parent workflow continuation)
        if (doneEdges.length > 0 && parentNodes.length > 0) {
          console.log(
            `🔗 Queuing ${doneEdges.length} continuation jobs from loop ${loopId}`
          );

          for (const edge of doneEdges) {
            const continuationRunId = uuidv4();

            await workflowQueue.add(
              "workflow-continuation",
              {
                runId: continuationRunId,
                workflowId,
                userId,
                nodes: parentNodes,
                edges: parentEdges,
                trigger: "loop_continuation",
                initialInput: {
                  data: aggregatedOutput,
                  $loopResult: {
                    loopId,
                    totalItems,
                    successCount: totalItems! - errorCount,
                    errorCount,
                    hasErrors,
                  },
                },
                // Start execution from the done edge target node
                startNodeId: edge.target,
                parentRunId,
                loopId,
              } as WorkflowJobData & { startNodeId: string },
              {
                removeOnComplete: 50,
                removeOnFail: 100,
              }
            );

            console.log(`📤 Queued continuation to node ${edge.target}`);
          }
        } else {
          // No done edges - Loop is a terminal node, complete the parent workflow run with aggregated result
          console.log(
            `📋 No done edges for loop ${loopId} - completing parent run ${parentRunId}`
          );

          const finalResult = createSuccessOutput(
            {
              finalOutput: aggregatedOutput,
              loopResult: {
                loopId,
                totalItems,
                successCount: totalItems! - errorCount,
                errorCount,
                hasErrors,
                completedAt: new Date().toISOString(),
              },
            },
            { nodeName: loopId, category: "loop" }
          );

          if (useRedisStorage) {
            // Update Redis-stored run
            await redis.hset(`runs:data:${parentRunId}`, {
              status: "success",
              result: JSON.stringify(finalResult),
              completed_at: new Date().toISOString(),
            });
            console.log(
              `✅ Parent run ${parentRunId} completed in Redis with loop result`
            );
          } else {
            // Update Supabase directly
            await supabase
              .from("workflow_runs")
              .update({
                status: "success",
                result: finalResult,
                completed_at: new Date().toISOString(),
              })
              .eq("id", parentRunId);
            console.log(
              `✅ Parent run ${parentRunId} completed in Supabase with loop result`
            );
          }
        }

        // Signal completion via Redis pub/sub (for monitoring/debugging)
        await redis.publish(
          "loop:completed",
          JSON.stringify({
            parentRunId,
            loopId,
            workflowId,
            userId,
            resultCount: results.length,
            successCount: totalItems! - errorCount,
            errorCount,
            hasErrors,
            continuationQueued: doneEdges.length > 0,
          })
        );

        // Cleanup Redis keys after successful aggregation
        await cleanupLoopKeys(parentRunId!, loopId!);

        return createSuccessOutput(
          {
            aggregated: aggregatedOutput,
            count: results.length,
            successCount: totalItems! - errorCount,
            errorCount,
            continuationQueued: doneEdges.length > 0,
          },
          { nodeName: loopId, category: "loop" }
        );
      } catch (error) {
        const errorOutput = createErrorOutput(error, {
          nodeName: loopId,
          category: "loop",
        });
        console.error(
          `❌ Loop aggregation failed for ${loopId}:`,
          errorOutput.error
        );

        // Publish failure event
        await redis.publish(
          "loop:failed",
          JSON.stringify({
            parentRunId,
            loopId,
            error: errorOutput.error,
          })
        );

        throw new Error(errorOutput.error);
      }
    }

    // Handle loop continuation (resuming parent workflow after parallel loop completes)
    if (trigger === "loop_continuation") {
      const startNodeId = (job.data as any).startNodeId;
      console.log(
        `🔗 Continuing workflow from node ${startNodeId} after parallel loop ${loopId}`
      );

      try {
        // Execute continuation workflow starting from the done edge target
        const result = await executeWorkflow(
          runId,
          workflowId,
          userId,
          nodes,
          edges,
          {
            initialInput: job.data.initialInput,
            startNodeId, // Pass start node to workflow engine
            abortSignal: signal, // Pass abort signal from BullMQ for cancellation
          }
        );

        console.log(
          `✅ Workflow continuation completed from node ${startNodeId}`
        );
        return createSuccessOutput(result, {
          nodeName: startNodeId,
          category: "loop_continuation",
        });
      } catch (error) {
        const errorOutput = createErrorOutput(error, {
          nodeName: startNodeId,
          category: "loop_continuation",
        });
        console.error(
          `❌ Workflow continuation failed from node ${startNodeId}:`,
          errorOutput.error
        );
        throw new Error(errorOutput.error);
      }
    }

    // Normal workflow execution
    console.log(
      `🚀 Processing workflow job ${job.id} for run ${runId} (Redis storage: ${useRedisStorage})`
    );

    // Check if workflow was cancelled while job was queued
    const isCancelled = await redis.get(`workflow:${workflowId}:cancelled`);
    if (isCancelled) {
      console.log(
        `🛑 Workflow ${workflowId} was cancelled, skipping execution for run ${runId}`
      );

      // Mark run as cancelled
      if (useRedisStorage) {
        await updateRunStatusInRedis(runId, "cancelled", {
          errorMessage: "Workflow deactivated by user",
        });
      } else {
        await supabase
          .from("workflow_runs")
          .update({
            status: "cancelled",
            error_message: "Workflow deactivated by user",
            completed_at: new Date().toISOString(),
          })
          .eq("id", runId);
      }

      return { cancelled: true, reason: "workflow_deactivated" } as const;
    }

    // Check abort signal before starting (in case job was cancelled immediately)
    if (signal?.aborted) {
      console.log(`🛑 Job ${job.id} was cancelled before starting`);
      throw new Error("Workflow cancelled by user");
    }

    let executionResult:
      | Awaited<ReturnType<typeof executeWorkflow>>
      | undefined;

    try {
      // Update run status to running
      if (useRedisStorage) {
        await updateRunStatusInRedis(runId, "running");
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
        {
          initialInput: renamed,
          abortSignal: signal, // Pass abort signal from BullMQ for cancellation
        }
      );
      executionResult = result;

      // Check if workflow actually succeeded - if not, throw to enter catch block
      if (result.success !== true) {
        throw new Error(result.error || "Workflow execution failed");
      }

      // Save successful result (only if not already cancelled)
      if (useRedisStorage) {
        await updateRunStatusInRedis(runId, "success", { result });
      } else {
        // Guard: only update to success if status is still running/queued (not cancelled)
        await supabase
          .from("workflow_runs")
          .update({
            status: "success",
            result: result,
            completed_at: new Date().toISOString(),
          })
          .eq("id", runId)
          .in("status", ["running", "queued"]);
      }

      console.log(`✅ Workflow run ${runId} completed successfully`);
      return createSuccessOutput(result, {
        nodeName: "workflow",
        category: "execution",
      });
    } catch (error) {
      const errorOutput = createErrorOutput(error, {
        nodeName: "workflow",
        category: "execution",
      });
      const errorMessage =
        errorOutput.error || (error as Error).message || "Unknown error";

      // Detect if this was a cancellation (not a real failure)
      const isCancellation =
        errorMessage.toLowerCase().includes("cancelled") ||
        errorMessage.toLowerCase().includes("deactivated");

      const status = isCancellation ? "cancelled" : "failed";

      console.log(
        `${isCancellation ? "🛑" : "❌"} Workflow run ${runId} ${status}:`,
        errorMessage
      );

      // Save error with appropriate status
      if (useRedisStorage) {
        await updateRunStatusInRedis(runId, status, {
          errorMessage,
          result: executionResult,
        });
      } else {
        await supabase
          .from("workflow_runs")
          .update({
            status,
            result: executionResult ?? null,
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
          })
          .eq("id", runId);
      }

      // For cancellations, don't throw (job completed successfully by stopping)
      if (isCancellation) {
        return { cancelled: true, reason: errorMessage };
      }

      throw new Error(errorMessage);
    }
  },
  {
    connection: redis,
    concurrency: parseInt(process.env.WORKFLOW_JOB_CONCURRENCY || "5"),
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
    lockDuration: 300000, // 5 minutes (default is 30s) - for long-running loops
    stalledInterval: 60000, // Check for stalled jobs every 60 seconds
    maxStalledCount: 3, // Allow 3 stall checks before marking as stalled
  }
);

// Scheduled workflow worker
const scheduledWorker = new Worker(
  "scheduled-workflows",
  async (job: Job<ScheduledWorkflowJobData>) => {
    const { workflowId, userId } = job.data;
    const scheduledTimestamp = job.timestamp ?? Date.now();

    console.log(
      `⏰ Processing scheduled workflow ${workflowId} (jobId=${
        job.id
      }, fireTime=${new Date(scheduledTimestamp).toISOString()})`
    );

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

      // Create workflow run with snapshot of current workflow state
      const { data: run, error: runError } = await supabase
        .from("workflow_runs")
        .insert({
          workflow_id: workflowId,
          status: "queued",
          initiated_by: userId,
          schedule_key: job.id,
          nodes: workflow.nodes,
          edges: workflow.edges,
          node_count: Array.isArray(workflow.nodes) ? workflow.nodes.length : 0,
          edge_count: Array.isArray(workflow.edges) ? workflow.edges.length : 0,
        })
        .select()
        .single();

      if (runError) {
        if ((runError as any).code === "23505") {
          console.warn(
            `⚠️ Duplicate scheduled run prevented for workflow ${workflowId} (schedule_key=${job.id})`
          );
          return createSuccessOutput(
            { skipped: true, schedule_key: job.id },
            { nodeName: "scheduler", category: "scheduled" }
          );
        }
        throw new Error(`Failed to create workflow run: ${runError.message}`);
      }
      const jobId = `${userId}:${workflowId}:${run.id}`;
      const data = {
        runId: run.id,
        workflowId,
        userId,
        nodes: workflow.nodes,
        edges: workflow.edges,
        trigger: "scheduled",
      };

      workflowQueue.add("execute-workflow", data, {
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

      // await workflowQueue.add(
      //   "execute-workflow",
      //   {
      //     runId: run.id,
      //     workflowId,
      //     userId,
      //     nodes: workflow.nodes,
      //     edges: workflow.edges,
      //     trigger: "scheduled",
      //   },
      //   { jobId: job.id }
      // );

      console.log(
        `✅ Scheduled workflow run created for ${workflowId} (runId=${run.id}, schedule_key=${job.id})`
      );
      return createSuccessOutput(
        { runId: run.id, scheduleKey: job.id },
        { nodeName: "scheduler", category: "scheduled" }
      );
    } catch (error) {
      const errorOutput = createErrorOutput(error, {
        nodeName: "scheduler",
        category: "scheduled",
      });
      console.error(
        `❌ Scheduled workflow failed for ${workflowId}:`,
        errorOutput.error
      );
      throw new Error(errorOutput.error);
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
  await redis.quit();
  console.log("✅ All queue resources cleaned up");
});
