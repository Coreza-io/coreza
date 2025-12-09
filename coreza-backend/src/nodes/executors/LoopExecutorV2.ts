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

import { bullMqJobQueue } from '../../services/jobQueueManager';
import { extractLoopBodySubgraph } from '../../services/loopSubgraphExtractor';
import { INodeExecutorV2, WorkflowEdge, WorkflowNode, Item, NodeExecutionOutput, ControlFlags } from '../types';

/**
 * Experimental Loop executor for EngineV2.
 * Processes items in batches and re-queues itself until completion.
 * Maintains `startIndex` and optional aggregation in node state.
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
    const configuredItems: Item[] = Array.isArray(params.items)
      ? params.items
      : input;
    const items: Item[] = Array.isArray(configuredItems)
      ? configuredItems
      : configuredItems
      ? [configuredItems]
      : [];
    const batchSize: number = Number(params.batchSize) || 1;
    const aggregate: boolean = !!params.aggregate;
    const parallel: boolean = !!params.parallel;
    const throttleMs: number = Number(params.throttleMs) || 0;

    let startIndex: number = context.getState('startIndex') || 0;
    let aggregation: Item[] | undefined = context.getState('aggregation');
    if (aggregate && !aggregation) aggregation = [];

    const canDistribute =
      parallel &&
      items.length > 1 &&
      context.runId &&
      context.workflowId &&
      context.userId &&
      context.nodes &&
      context.edges;

    if (canDistribute) {
      const subgraph = extractLoopBodySubgraph(
        node.id,
        context.nodes!,
        context.edges!
      );

      await bullMqJobQueue.addParallelLoopExecution(
        context.runId!,
        node.id,
        context.workflowId!,
        context.userId!,
        subgraph.nodes,
        subgraph.edges,
        items,
        true
      );

      const control: ControlFlags = {
        setState: {
          startIndex: undefined,
          aggregation: undefined,
        },
      };

      return { output: [], control };
    }

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
