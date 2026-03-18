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

import {
  INodeExecutorV2,
  WorkflowNode,
  WorkflowEdge,
  Item,
  NodeExecutionOutput,
  ControlFlags,
} from "../types";
import { bullMqJobQueue } from "../../infra/jobQueue/jobQueueManager";
import { extractLoopBodySubgraph } from "../../engine";

/**
 * Production-grade Loop executor for EngineV2.
 *
 * Supports two execution modes:
 *
 * 1. Sequential Mode (default):
 *    - Processes items in batches and re-queues itself until completion
 *    - Suitable for workflows that need strict ordering or low-volume processing
 *    - Supports throttling between batches
 *
 * 2. Parallel Mode (BullMQ Distributed):
 *    - Creates separate BullMQ jobs per item for true distributed parallelism
 *    - Items are processed across multiple workers simultaneously
 *    - Supports maxConcurrency to limit parallel workers
 *    - Supports continueOnError for fault-tolerant processing
 *    - Results are aggregated in order after all items complete
 *
 * Performance characteristics:
 * - Sequential: 20 items × 1s each = ~20s total
 * - Parallel (5 workers): 20 items × 1s each = ~4s total
 */
export class LoopExecutorV2 implements INodeExecutorV2 {
  readonly category = "control";

  async execute(
    node: WorkflowNode,
    params: any,
    input: Item[],
    context: {
      getState: (k: string) => any;
      setState: (k: string, v: any) => void;
      runId?: string;
      workflowId?: string;
      userId?: string;
      nodes?: WorkflowNode[];
      edges?: WorkflowEdge[];
      /** Get all node results accumulated so far (for parent context sharing) */
      getAllNodeResults?: () => Record<string, any>;
      /** Abort signal for cancellation detection - triggered immediately by BullMQ's cancelJob() */
      abortSignal?: AbortSignal;
    },
  ): Promise<NodeExecutionOutput> {
    // Items come either from params or upstream input
    const items: Item[] = Array.isArray(params.items) ? params.items : input;
    const batchSize: number = Number(params.batchSize) || 1;
    const aggregate: boolean = !!params.aggregate;
    const parallel: boolean = !!params.parallel;
    const throttleMs: number = Number(params.throttleMs) || 0;
    const maxConcurrency: number = Number(params.maxConcurrency) || 10;
    const continueOnError: boolean = !!params.continueOnError;

    // Validate items
    if (!items || items.length === 0) {
      console.log(`⚠️ Loop ${node.id}: No items to process`);
      return { output: [], control: {} };
    }

    // DISTRIBUTED PARALLEL MODE
    // When parallel=true and we have context for BullMQ, distribute items across workers
    if (
      parallel &&
      items.length > 1 &&
      context.runId &&
      context.workflowId &&
      context.userId &&
      context.nodes &&
      context.edges
    ) {
      // Capture parent workflow store data for child context
      // This allows child jobs to reference ANY upstream node's output
      const parentStoreData = context.getAllNodeResults
        ? context.getAllNodeResults()
        : {};
      console.log(
        `📦 Loop ${node.id}: Captured parent store with ${Object.keys(parentStoreData).length} node outputs for child context`,
      );
      console.log(
        `🔄 Loop ${node.id}: Distributing ${items.length} items across BullMQ workers (maxConcurrency: ${maxConcurrency})`,
      );

      // Extract the loop body subgraph (nodes connected to "loop" handle)
      const subgraph = extractLoopBodySubgraph(
        node.id,
        context.nodes,
        context.edges,
      );

      if (subgraph.nodes.length === 0) {
        console.warn(
          `⚠️ Loop ${node.id}: No nodes found in loop body, skipping parallel execution`,
        );
        return { output: items, control: {} };
      }

      console.log(
        `📦 Loop ${node.id}: Extracted subgraph with ${subgraph.nodes.length} nodes and ${subgraph.edges.length} edges`,
      );

      // Extract "done" edges from this loop node for continuation after aggregation
      const doneEdges = context.edges.filter(
        (e: WorkflowEdge) => e.source === node.id && e.sourceHandle === "done",
      );

      console.log(
        `🔗 Loop ${node.id}: Found ${doneEdges.length} done edges for continuation`,
      );

      // Create N BullMQ jobs (one per item) with aggregator parent
      await bullMqJobQueue.addParallelLoopExecution(
        context.runId,
        node.id,
        context.workflowId,
        context.userId,
        subgraph.nodes,
        subgraph.edges,
        items,
        {
          maxConcurrency,
          continueOnError,
          useRedisStorage: true,
          doneEdges,
          parentNodes: context.nodes,
          parentEdges: context.edges,
          parentStoreData, // Share parent workflow context with children
        },
      );

      // Return control flag indicating parallel distribution
      // The aggregator job will handle collecting results and continuing the workflow
      return {
        output: [],
        control: {
          parallelDistributed: true,
          itemCount: items.length,
          loopId: node.id,
          maxConcurrency,
          continueOnError,
        },
      };
    }

    // Single item with parallel=true - just process normally
    if (parallel && items.length === 1) {
      console.log(`⚡ Loop ${node.id}: Single item, processing directly`);
      return {
        output: items,
        control: {},
      };
    }

    // SEQUENTIAL MODE (existing logic with enhancements)
    let startIndex: number = context.getState("startIndex") || 0;
    let aggregation: Item[] | undefined = context.getState("aggregation");
    let errors: any[] | undefined = context.getState("errors");

    if (aggregate && !aggregation) aggregation = [];
    if (continueOnError && !errors) errors = [];

    // Check for cancellation before processing batch
    // Uses AbortSignal directly - BullMQ's worker.cancelJob() triggers this immediately
    if (context.abortSignal?.aborted) {
      console.log(
        `🛑 Loop ${node.id}: Workflow cancelled via AbortSignal, stopping`,
      );
      return { output: [], control: { cancelled: true } };
    }

    const batch = items.slice(startIndex, startIndex + batchSize);
    startIndex += batch.length;

    if (aggregate) {
      aggregation!.push(...batch);
      context.setState("aggregation", aggregation);
    }

    const control: ControlFlags = {};
    if (startIndex < items.length) {
      // More items remain – persist start index and re-queue
      context.setState("startIndex", startIndex);
      // Unified loop control flags
      control.loopIteration = true;
      control.sourceHandle = "loop";
      control.currentIndex = startIndex - batch.length;
      control.isLastBatch = false;
      control.requeueSelf = true; // Keep for EngineV2 backward compatibility
      if (throttleMs > 0) {
        control.throttleUntil = Date.now() + throttleMs;
      }
      return { output: batch, control };
    }

    // Final batch processed – clear state and emit aggregated results
    context.setState("startIndex", undefined);
    let output: Item[] = batch;
    if (aggregate) {
      output = aggregation!;
      context.setState("aggregation", undefined);
    }

    // Final batch - use unified completion flags
    const completionControl: ControlFlags = {
      loopCompleted: true,
      sourceHandle: "done",
      isLastBatch: true,
    };

    // Include error summary if continueOnError was used
    if (continueOnError && errors && errors.length > 0) {
      context.setState("errors", undefined);
      return {
        output,
        control: completionControl,
        meta: {
          errorCount: errors.length,
          errors,
        },
      };
    }

    return { output, control: completionControl };
  }
}

export default LoopExecutorV2;
