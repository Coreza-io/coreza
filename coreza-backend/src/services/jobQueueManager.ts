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
import { IWorkflowJobQueue, WorkflowJobData, ParallelLoopOptions } from "./queueInterface";
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

/** Result structure for each loop item */
interface LoopItemResult {
  success: boolean;
  itemIndex: number;
  data?: any;
  error?: string;
}

/**
 * Collects and orders results from Redis hash by itemIndex.
 * Handles both successful and failed items gracefully.
 */
async function collectOrderedResults(
  parentRunId: string,
  loopId: string,
  totalItems: number,
  continueOnError: boolean
): Promise<{ results: LoopItemResult[]; hasErrors: boolean; errorCount: number }> {
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
        if (parsed.error) {
          hasErrors = true;
          errorCount++;
          results[i] = {
            success: false,
            itemIndex: i,
            error: parsed.error,
          };
        } else {
          results[i] = {
            success: true,
            itemIndex: i,
            data: parsed,
          };
        }
      } catch {
        results[i] = {
          success: false,
          itemIndex: i,
          error: "Failed to parse result",
        };
        hasErrors = true;
        errorCount++;
      }
    } else {
      // Missing result - treat as error
      results[i] = {
        success: false,
        itemIndex: i,
        error: "No result received",
      };
      hasErrors = true;
      errorCount++;
    }
  }
  
  return { results, hasErrors, errorCount };
}

/**
 * Pre-resolves loop-related template expressions for a single loop item.
 * Replaces $('Loop') and $loopContext references with actual item values.
 * This is critical for parallel execution where child workers don't have access to parent Loop node store.
 */
function resolveLoopTemplatesForItem(
  values: Record<string, any>,
  item: any,
  itemIndex: number,
  totalItems: number
): Record<string, any> {
  const loopContext = {
    itemIndex,
    totalItems,
    isFirstItem: itemIndex === 0,
    isLastItem: itemIndex === totalItems - 1,
  };
  
  function resolveValue(val: any): any {
    if (typeof val !== 'string') return val;
    
    // Serialize item for replacement
    const itemStr = typeof item === 'object' ? JSON.stringify(item) : String(item);
    
    // Replace $('Loop').json.data patterns (various accessor styles)
    let resolved = val
      // $('Loop').json.data.[0] or $('Loop').json.data[0] → item itself
      .replace(/\{\{\s*\$\(['"]Loop['"]\)\.json\.data\.?\[0\]\s*\}\}/gi, itemStr)
      // $('Loop').json.data → full item
      .replace(/\{\{\s*\$\(['"]Loop['"]\)\.json\.data\s*\}\}/gi, itemStr)
      // $('Loop').json → full item (common shorthand)
      .replace(/\{\{\s*\$\(['"]Loop['"]\)\.json\s*\}\}/gi, itemStr)
      // $loopContext patterns
      .replace(/\{\{\s*\$loopContext\.itemIndex\s*\}\}/gi, String(itemIndex))
      .replace(/\{\{\s*\$loopContext\.isFirstItem\s*\}\}/gi, String(loopContext.isFirstItem))
      .replace(/\{\{\s*\$loopContext\.isLastItem\s*\}\}/gi, String(loopContext.isLastItem))
      .replace(/\{\{\s*\$loopContext\.totalItems\s*\}\}/gi, String(totalItems));
    
    // Handle nested property access like $('Loop').json.data.[0].symbol
    // Pattern: {{ $('Loop').json.data.[0].propertyPath }}
    resolved = resolved.replace(
      /\{\{\s*\$\(['"]Loop['"]\)\.json\.data\.?\[0\]\.([a-zA-Z0-9_.]+)\s*\}\}/gi,
      (match, propertyPath) => {
        try {
          const keys = propertyPath.split('.');
          let value = item;
          for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
              value = value[key];
            } else {
              return match; // Property not found, leave unchanged
            }
          }
          return typeof value === 'object' ? JSON.stringify(value) : String(value);
        } catch {
          return match;
        }
      }
    );
    
    return resolved;
  }
  
  function resolveDeep(obj: any): any {
    if (typeof obj === 'string') return resolveValue(obj);
    if (Array.isArray(obj)) return obj.map(resolveDeep);
    if (obj && typeof obj === 'object') {
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, resolveDeep(v)])
      );
    }
    return obj;
  }
  
  return resolveDeep(values);
}

/**
 * Pre-resolves loop templates in all subgraph nodes for a specific item.
 * Returns a new array of nodes with resolved values.
 */
function preResolveSubgraphForItem(
  subgraphNodes: any[],
  item: any,
  itemIndex: number,
  totalItems: number
): any[] {
  return subgraphNodes.map(node => ({
    ...node,
    values: resolveLoopTemplatesForItem(node.values || {}, item, itemIndex, totalItems),
  }));
}

/**
 * Cleans up Redis keys after loop aggregation completes.
 */
async function cleanupLoopKeys(parentRunId: string, loopId: string): Promise<void> {
  const keysToDelete = [
    `loop:${parentRunId}:${loopId}:results`,
    `loop:${parentRunId}:${loopId}:aggregated`,
    `loop:${parentRunId}:${loopId}:meta`,
  ];
  
  await Promise.all(keysToDelete.map(key => redis.del(key)));
  console.log(`🧹 Cleaned up Redis keys for loop ${loopId}`);
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
      totalItems,
      continueOnError = false,
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

        // Store successful result in Redis by itemIndex
        const key = `loop:${parentRunId}:${loopId}:results`;
        await redis.hset(key, String(itemIndex), JSON.stringify(result));
        await redis.expire(key, 3600); // 1 hour TTL

        console.log(`✅ Loop item ${(itemIndex ?? 0) + 1}/${totalItems} completed`);
        return { success: true, itemIndex, data: result };
      } catch (error) {
        const normalized = normalizeError(error);
        console.error(`❌ Loop item ${(itemIndex ?? 0) + 1}/${totalItems} failed:`, normalized.message);
        
        // Store error in Redis for aggregation (allows continueOnError)
        const key = `loop:${parentRunId}:${loopId}:results`;
        await redis.hset(key, String(itemIndex), JSON.stringify({ error: normalized.message }));
        await redis.expire(key, 3600);
        
        // If continueOnError is false, throw to fail the job
        if (!continueOnError) {
          throw normalized;
        }
        
        // Return error result for aggregation
        return { success: false, itemIndex, error: normalized.message };
      }
    }

    // Handle aggregator (parent job that waits for all children)
    if (isLoopAggregator) {
      console.log(`📊 Aggregating ${totalItems} parallel loop results for loop ${loopId}`);
      
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
        
        // Extract just the data for successful items, keep error info for failed
        const aggregatedOutput = results.map(r => 
          r.success ? r.data : { _error: r.error, _itemIndex: r.itemIndex }
        );

        // Store aggregated results for parent workflow to retrieve
        const aggregatedKey = `loop:${parentRunId}:${loopId}:aggregated`;
        await redis.set(aggregatedKey, JSON.stringify({
          results: aggregatedOutput,
          meta: {
            totalItems,
            successCount: totalItems! - errorCount,
            errorCount,
            hasErrors,
            completedAt: new Date().toISOString(),
          }
        }));
        await redis.expire(aggregatedKey, 3600);

        console.log(`✅ Aggregated ${results.length} loop results (${errorCount} errors) for loop ${loopId}`);
        
        // Queue continuation jobs for done edges (parent workflow continuation)
        if (doneEdges.length > 0 && parentNodes.length > 0) {
          console.log(`🔗 Queuing ${doneEdges.length} continuation jobs from loop ${loopId}`);
          
          for (const edge of doneEdges) {
            const continuationRunId = uuidv4();
            
            await workflowQueue.add('workflow-continuation', {
              runId: continuationRunId,
              workflowId,
              userId,
              nodes: parentNodes,
              edges: parentEdges,
              trigger: 'loop_continuation',
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
            } as WorkflowJobData & { startNodeId: string }, {
              removeOnComplete: 50,
              removeOnFail: 100,
            });
            
            console.log(`📤 Queued continuation to node ${edge.target}`);
          }
        } else {
          // No done edges - Loop is a terminal node, complete the parent workflow run with aggregated result
          console.log(`📋 No done edges for loop ${loopId} - completing parent run ${parentRunId}`);
          
          const finalResult = {
            finalOutput: aggregatedOutput,
            loopResult: {
              loopId,
              totalItems,
              successCount: totalItems! - errorCount,
              errorCount,
              hasErrors,
              completedAt: new Date().toISOString(),
            }
          };
          
          if (useRedisStorage) {
            // Update Redis-stored run
            await redis.hset(`runs:data:${parentRunId}`, {
              status: 'success',
              result: JSON.stringify(finalResult),
              completed_at: new Date().toISOString(),
            });
            console.log(`✅ Parent run ${parentRunId} completed in Redis with loop result`);
          } else {
            // Update Supabase directly
            await supabase.from('workflow_runs').update({
              status: 'success',
              result: finalResult,
              completed_at: new Date().toISOString(),
            }).eq('id', parentRunId);
            console.log(`✅ Parent run ${parentRunId} completed in Supabase with loop result`);
          }
        }

        // Signal completion via Redis pub/sub (for monitoring/debugging)
        await redis.publish('loop:completed', JSON.stringify({
          parentRunId,
          loopId,
          workflowId,
          userId,
          resultCount: results.length,
          successCount: totalItems! - errorCount,
          errorCount,
          hasErrors,
          continuationQueued: doneEdges.length > 0,
        }));
        
        // Cleanup Redis keys after successful aggregation
        await cleanupLoopKeys(parentRunId!, loopId!);
        
        return { 
          aggregated: aggregatedOutput, 
          count: results.length,
          successCount: totalItems! - errorCount,
          errorCount,
          continuationQueued: doneEdges.length > 0,
        };
      } catch (error) {
        const normalized = normalizeError(error);
        console.error(`❌ Loop aggregation failed for ${loopId}:`, normalized.message);
        
        // Publish failure event
        await redis.publish('loop:failed', JSON.stringify({
          parentRunId,
          loopId,
          error: normalized.message,
        }));
        
        throw normalized;
      }
    }

    // Handle loop continuation (resuming parent workflow after parallel loop completes)
    if (trigger === 'loop_continuation') {
      const startNodeId = (job.data as any).startNodeId;
      console.log(`🔗 Continuing workflow from node ${startNodeId} after parallel loop ${loopId}`);
      
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
          }
        );

        console.log(`✅ Workflow continuation completed from node ${startNodeId}`);
        return result;
      } catch (error) {
        const normalized = normalizeError(error);
        console.error(`❌ Workflow continuation failed from node ${startNodeId}:`, normalized.message);
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
    
    console.log(`🔄 Creating ${items.length} parallel loop jobs for loop ${loopId} (maxConcurrency: ${maxConcurrency}, continueOnError: ${continueOnError})`);

    // Store loop metadata in Redis for continuation
    await redis.set(`loop:${parentRunId}:${loopId}:meta`, JSON.stringify({
      totalItems: items.length,
      maxConcurrency,
      continueOnError,
      startedAt: new Date().toISOString(),
    }));
    await redis.expire(`loop:${parentRunId}:${loopId}:meta`, 3600);

    // Create child jobs with rate limiting via delay
    // BullMQ will process up to `concurrency` jobs simultaneously
    // We add incremental delays to chunks beyond the first maxConcurrency items
    // CRITICAL: Pre-resolve loop templates in each node's values before creating child jobs
    // This ensures $('Loop').json.data references resolve to actual item values
    const childJobs = items.map((item, i) => {
      // Calculate delay to implement per-loop rate limiting
      // Jobs within the first maxConcurrency batch have no delay
      // Subsequent batches are delayed incrementally
      const batchIndex = Math.floor(i / maxConcurrency);
      const delayMs = batchIndex > 0 ? batchIndex * 100 : 0; // 100ms between batches
      
      // Pre-resolve loop templates in subgraph nodes for this specific item
      // This converts "{{ $('Loop').json.data.[0] }}" → actual item value (e.g., "AAPL")
      const resolvedNodes = preResolveSubgraphForItem(subgraphNodes, item, i, items.length);
      
      return {
        name: `loop-item-${i}`,
        queueName: 'workflow-execution',
        data: {
          runId: uuidv4(),
          workflowId,
          userId,
          nodes: resolvedNodes, // Use pre-resolved nodes instead of raw subgraphNodes
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
          continueOnError,
        } as WorkflowJobData,
        opts: {
          removeOnComplete: 50,
          removeOnFail: continueOnError ? 50 : 100,
          attempts: continueOnError ? 1 : 3, // No retries if continueOnError
          delay: delayMs,
          backoff: continueOnError ? undefined : {
            type: "exponential" as const,
            delay: 2000,
          },
          // Allow parent to complete even if some children fail when continueOnError is true
          failParentOnFailure: !continueOnError,
        },
      };
    });
    
    console.log(`📝 Pre-resolved loop templates for ${items.length} child jobs`);

    // Create the flow with parent aggregator and children
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
        continueOnError,
        // Include continuation metadata for done edge routing
        doneEdges: options.doneEdges || [],
        parentNodes: options.parentNodes || [],
        parentEdges: options.parentEdges || [],
      } as WorkflowJobData & { doneEdges: any[]; parentNodes: any[]; parentEdges: any[] },
      opts: {
        removeOnComplete: 50,
        removeOnFail: 100,
      },
      children: childJobs,
    });

    console.log(`✅ Created ${items.length} parallel loop jobs with aggregator (${Math.ceil(items.length / maxConcurrency)} batches)`);
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
