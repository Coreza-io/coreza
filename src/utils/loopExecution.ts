import type { Edge } from '@xyflow/react';
import type { ExecutionContext, NodeExecutionDetail } from './workflowExecutor';

/**
 * Handle Loop node execution - execute downstream nodes once per item
 */
export async function handleLoopExecution(
  context: ExecutionContext,
  loopNodeId: string,
  loopResult: any,
  outgoingEdges: Edge[],
  executed: Set<string>
): Promise<void> {
  const {
    items,
    batchSize = 1,
    parallel = false,
    continueOnError = false,
    throttleMs = 200,
  } = loopResult;
  console.log(`🔄 [LOOP EXECUTOR] Starting loop execution for ${items.length} items with batch size ${batchSize}`);

  const pending: Promise<void>[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    console.log(
      `🔄 [LOOP EXECUTOR] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)}: items ${i}-${i + batch.length - 1}`
    );

    const payload = batchSize > 1 ? batch : batch[0];
    updateDownstreamNodesWithLoopData(context, outgoingEdges, payload, i);

    const runEdge = (edge: Edge) =>
      executeLoopIteration(
        context,
        edge.target,
        payload,
        i,
        executed,
        throttleMs,
        continueOnError
      );

    if (parallel) {
      outgoingEdges.forEach((edge) => pending.push(runEdge(edge)));
    } else {
      for (const edge of outgoingEdges) {
        try {
          await runEdge(edge);
        } catch (err) {
          if (!continueOnError) throw err;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, throttleMs));
    }
  }

  if (parallel) {
    if (continueOnError) {
      await Promise.allSettled(pending);
    } else {
      await Promise.all(pending);
    }
  }

  console.log(`🎉 [LOOP EXECUTOR] Completed loop execution for all ${items.length} items`);
  const firstItem = items[0];
  context.setNodes(nodes =>
    nodes.map(node =>
      node.id === loopNodeId
        ? {
            ...node,
            data: {
              ...node.data,
              output: firstItem,
              loopItem: firstItem,
              loopIndex: 0,
            }
          }
        : node
    )
  );
}

export function updateDownstreamNodesWithLoopData(
  context: ExecutionContext,
  outgoingEdges: Edge[],
  item: any,
  index: number
): void {
  context.setNodes(nodes =>
    nodes.map(node => {
      const isDownstream = outgoingEdges.some(edge => edge.target === node.id);
      if (isDownstream) {
        return {
          ...node,
          data: {
            ...node.data,
            input: item,
            loopItem: item,
            loopIndex: index,
            lastUpdated: new Date().toISOString(),
          }
        };
      }
      return node;
    })
  );
}

async function executeLoopIteration(
  context: ExecutionContext,
  nodeId: string,
  item: any,
  index: number,
  executed: Set<string>,
  throttleMs: number,
  continueOnError: boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      console.log(`🔄 [LOOP ITERATION] Executing node ${nodeId} with item ${index}:`, item);

      const execEvent = new CustomEvent('auto-execute-node', {
        detail: {
          nodeId,
          executedNodes: executed,
          allNodes: context.nodes,
          allEdges: context.edges,
          explicitlyTriggered: true,
          loopItem: item,
          loopIndex: index,
          onSuccess: async () => {
            console.log(`✅ [LOOP ITERATION] Node ${nodeId} iteration ${index} succeeded`);
            await new Promise((r) => setTimeout(r, throttleMs));
            resolve();
          },
          onError: async (err: any) => {
            console.error(`❌ [LOOP ITERATION] Node ${nodeId} iteration ${index} failed:`, err);
            await new Promise((r) => setTimeout(r, throttleMs));
            if (continueOnError) {
              resolve();
            } else {
              reject(err);
            }
          },
        } as NodeExecutionDetail,
      });

      window.dispatchEvent(execEvent);
    } catch (error) {
      console.error(`❌ [LOOP ITERATION] Failed to execute node ${nodeId} for item ${index}:`, error);
      if (continueOnError) resolve();
      else reject(error);
    }
  });
}

