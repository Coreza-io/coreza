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

import type Redis from "ioredis";
import { Job, Queue, Worker } from "bullmq";
import { v4 as uuidv4 } from "uuid";
import { supabase } from "../config/supabase";
import { executeWorkflow } from "../engine";
import { EnginePool } from "../engine";
import { updateRunStatusInRedis } from "./redisRunStorage";
import { initializeNodeExecutors, getAllRegisteredCategories } from "../nodes";
import { createSuccessOutput, createErrorOutput } from "./normalizeOutput";
import type { WorkflowJobData } from "../services/queueInterface";
import type {
  WorkflowJobResult,
  LoopItemResult,
} from "../types/workflowJobResult";

interface WorkflowWorkerDependencies {
  redis: Redis;
  workflowQueue: Queue;
}

/**
 * Collects and orders results from Redis hash by itemIndex.
 * Handles both successful and failed items gracefully.
 */
async function collectOrderedResults(
  redis: Redis,
  parentRunId: string,
  loopId: string,
  totalItems: number,
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
            },
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
 * Cleans up Redis keys after loop aggregation completes.
 */
async function cleanupLoopKeys(
  redis: Redis,
  parentRunId: string,
  loopId: string,
): Promise<void> {
  const keysToDelete = [
    `loop:${parentRunId}:${loopId}:results`,
    `loop:${parentRunId}:${loopId}:aggregated`,
    `loop:${parentRunId}:${loopId}:meta`,
  ];

  await Promise.all(keysToDelete.map((key) => redis.del(key)));
  console.log(`🧹 Cleaned up Redis keys for loop ${loopId}`);
}

export function createWorkflowWorker({
  redis,
  workflowQueue,
}: WorkflowWorkerDependencies): Worker<WorkflowJobData, WorkflowJobResult> {
  return new Worker<WorkflowJobData, WorkflowJobResult>(
    "workflow-execution",
    async (
      job: Job<WorkflowJobData>,
      token?: string,
      signal?: AbortSignal,
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
          }/${totalItems} for loop ${loopId}`,
        );

        const startNodeId = (job.data as any).startNodeId;
        console.log(
          `🎯 Loop item starting from node: ${startNodeId || "auto-detect"}`,
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
            executionKind: (job.data as any).executionKind,
            },
          );

          // Store successful result in Redis by itemIndex
          const key = `loop:${parentRunId}:${loopId}:results`;
          await redis.hset(key, String(itemIndex), JSON.stringify(result));
          await redis.expire(key, 3600); // 1 hour TTL

          console.log(
            `✅ Loop item ${(itemIndex ?? 0) + 1}/${totalItems} completed`,
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
            errorOutput.error,
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
          `📊 Aggregating ${totalItems} parallel loop results for loop ${loopId}`,
        );

        // Extract continuation metadata
        const doneEdges = (job.data as any).doneEdges || [];
        const parentNodes = (job.data as any).parentNodes || [];
        const parentEdges = (job.data as any).parentEdges || [];

        try {
          // Collect ordered results from Redis hash (more reliable than getChildrenValues)
          const { results, hasErrors, errorCount } =
            await collectOrderedResults(
              redis,
              parentRunId!,
              loopId!,
              totalItems ?? 0,
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
            }),
          );
          await redis.expire(aggregatedKey, 3600);

          console.log(
            `✅ Aggregated ${results.length} loop results (${errorCount} errors) for loop ${loopId}`,
          );

          // Queue continuation jobs for done edges (parent workflow continuation)
          if (doneEdges.length > 0 && parentNodes.length > 0) {
            console.log(
              `🔗 Queuing ${doneEdges.length} continuation jobs from loop ${loopId}`,
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
                },
              );

              console.log(`📤 Queued continuation to node ${edge.target}`);
            }
          } else {
            // No done edges - Loop is a terminal node, complete the parent workflow run with aggregated result
            console.log(
              `📋 No done edges for loop ${loopId} - completing parent run ${parentRunId}`,
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
              { nodeName: loopId, category: "loop" },
            );

            if (useRedisStorage) {
              // Update Redis-stored run
              await redis.hset(`runs:data:${parentRunId}`, {
                status: "success",
                result: JSON.stringify(finalResult),
                completed_at: new Date().toISOString(),
              });
              console.log(
                `✅ Parent run ${parentRunId} completed in Redis with loop result`,
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
                `✅ Parent run ${parentRunId} completed in Supabase with loop result`,
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
            }),
          );

          // Cleanup Redis keys after successful aggregation
          await cleanupLoopKeys(redis, parentRunId!, loopId!);

          return createSuccessOutput(
            {
              aggregated: aggregatedOutput,
              count: results.length,
              successCount: totalItems! - errorCount,
              errorCount,
              continuationQueued: doneEdges.length > 0,
            },
            { nodeName: loopId, category: "loop" },
          );
        } catch (error) {
          const errorOutput = createErrorOutput(error, {
            nodeName: loopId,
            category: "loop",
          });
          console.error(
            `❌ Loop aggregation failed for ${loopId}:`,
            errorOutput.error,
          );

          // Publish failure event
          await redis.publish(
            "loop:failed",
            JSON.stringify({
              parentRunId,
              loopId,
              error: errorOutput.error,
            }),
          );

          throw new Error(errorOutput.error);
        }
      }

      // Handle loop continuation (resuming parent workflow after parallel loop completes)
      if (trigger === "loop_continuation") {
        const startNodeId = (job.data as any).startNodeId;
        console.log(
          `🔗 Continuing workflow from node ${startNodeId} after parallel loop ${loopId}`,
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
            executionKind: (job.data as any).executionKind,
            },
          );

          console.log(
            `✅ Workflow continuation completed from node ${startNodeId}`,
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
            errorOutput.error,
          );
          throw new Error(errorOutput.error);
        }
      }

      // Normal workflow execution
      console.log(
        `🚀 Processing workflow job ${job.id} for run ${runId} (Redis storage: ${useRedisStorage})`,
      );

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

        if (trigger === "market_data") {
          console.warn(
            `⚠️ [Worker] Legacy market_data job ${job.id} for workflow ${workflowId} — skipping (handled by WorkflowRunner)`,
          );
          return {
            success: true,
            skipped: true,
            reason: "legacy_market_data_job",
          };
        }

        const run = EnginePool.getInstance().getOrCreate(
          workflowId,
          runId,
          userId,
          nodes,
          edges,
          {
            mode: "best-effort",
            abortSignal: signal,
            executionKind: (job.data as any).executionKind,
          },
        );

        let result: Awaited<ReturnType<typeof run.execute>>;
        try {
          result = await run.execute(renamed);
        } finally {
          run.destroy();
        }

        executionResult = result;

        // Check if workflow actually succeeded - if not, throw to enter catch block
        if (result.success !== true) {
          throw new Error(result.error?.message || "Workflow execution failed");
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
          errorMessage,
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
    },
  );
}
