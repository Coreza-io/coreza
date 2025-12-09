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

import { INodeExecutorV2, WorkflowNode, WorkflowEdge, Item, NodeExecutionOutput, ControlFlags } from '../types';
import { bullMqJobQueue } from '../../services/jobQueueManager';
import { extractLoopBodySubgraph } from '../../services/loopSubgraphExtractor';

/**
 * Experimental Loop executor for EngineV2.
 * Supports two execution modes:
 * 1. Sequential: Processes items in batches and re-queues itself until completion.
 * 2. Parallel (BullMQ Distributed): Creates separate BullMQ jobs per item for true distributed parallelism.
 */
export class LoopExecutorV2 implements INodeExecutorV2 {
  readonly category = 'control';

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
    }
  ): Promise<NodeExecutionOutput> {
    // Items come either from params or upstream input
    const items: Item[] = Array.isArray(params.items) ? params.items : input;
    const batchSize: number = Number(params.batchSize) || 1;
    const aggregate: boolean = !!params.aggregate;
    const parallel: boolean = !!params.parallel;
    const throttleMs: number = Number(params.throttleMs) || 0;
    const maxConcurrency: number = Number(params.maxConcurrency) || 10;

    // DISTRIBUTED PARALLEL MODE
    // When parallel=true and we have context for BullMQ, distribute items across workers
    if (parallel && items.length > 1 && context.runId && context.workflowId && context.userId && context.nodes && context.edges) {
      console.log(`🔄 Loop ${node.id}: Distributing ${items.length} items across BullMQ workers`);

      // Extract the loop body subgraph (nodes connected to "loop" handle)
      const subgraph = extractLoopBodySubgraph(
        node.id,
        context.nodes,
        context.edges
      );

      if (subgraph.nodes.length === 0) {
        console.warn(`⚠️ Loop ${node.id}: No nodes found in loop body, skipping parallel execution`);
        return { output: items, control: {} };
      }

      console.log(`📦 Loop ${node.id}: Extracted subgraph with ${subgraph.nodes.length} nodes and ${subgraph.edges.length} edges`);

      // Create N BullMQ jobs (one per item) with aggregator parent
      await bullMqJobQueue.addParallelLoopExecution(
        context.runId,
        node.id,
        context.workflowId,
        context.userId,
        subgraph.nodes,
        subgraph.edges,
        items,
        true // useRedisStorage for high-frequency
      );

      // Return control flag indicating parallel distribution
      // The aggregator job will handle collecting results
      return { 
        output: [], 
        control: { 
          parallelDistributed: true,
          itemCount: items.length,
          loopId: node.id,
        } 
      };
    }

    // SEQUENTIAL MODE (existing logic)
    let startIndex: number = context.getState('startIndex') || 0;
    let aggregation: Item[] | undefined = context.getState('aggregation');
    if (aggregate && !aggregation) aggregation = [];

    const batch = items.slice(startIndex, startIndex + batchSize);
    startIndex += batch.length;

    if (aggregate) {
      aggregation!.push(...batch);
      context.setState('aggregation', aggregation);
    }

    const control: ControlFlags = {};
    if (startIndex < items.length) {
      // More items remain – persist start index and re-queue
      context.setState('startIndex', startIndex);
      control.requeueSelf = true;
      if (throttleMs > 0) {
        control.throttleUntil = Date.now() + throttleMs;
      }
      return { output: batch, control };
    }

    // Final batch processed – clear state and emit aggregated results
    context.setState('startIndex', undefined);
    let output: Item[] = batch;
    if (aggregate) {
      output = aggregation!;
      context.setState('aggregation', undefined);
    }

    return { output, control };
  }
}

export default LoopExecutorV2;
