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
  const { items, batchSize = 1 } = loopResult;
  console.log(`🔄 [LOOP EXECUTOR] Starting loop execution for ${items.length} items with batch size ${batchSize}`);

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    console.log(`🔄 [LOOP EXECUTOR] Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(items.length/batchSize)}: items ${i}-${i + batch.length - 1}`);

    for (const item of batch) {
      const currentIndex = i + batch.indexOf(item);
      console.log(`🔄 [LOOP EXECUTOR] Processing item:`, item);

      updateDownstreamNodesWithLoopData(context, outgoingEdges, item, currentIndex);

      for (const edge of outgoingEdges) {
        const downstreamNodeId = edge.target;
        await executeLoopIteration(context, downstreamNodeId, item, currentIndex, executed);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`🎉 [LOOP EXECUTOR] Completed loop execution for all ${items.length} items`);
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
  executed: Set<string>
): Promise<void> {
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
          await new Promise(resolve => setTimeout(resolve, 200));
        },
        onError: async (err: any) => {
          console.error(`❌ [LOOP ITERATION] Node ${nodeId} iteration ${index} failed:`, err);
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } as NodeExecutionDetail
    });

    window.dispatchEvent(execEvent);
  } catch (error) {
    console.error(`❌ [LOOP ITERATION] Failed to execute node ${nodeId} for item ${index}:`, error);
  }
}

