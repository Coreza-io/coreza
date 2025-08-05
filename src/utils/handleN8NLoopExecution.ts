import type { Edge, Node } from '@xyflow/react';
import type { ExecutionContext } from './workflowExecutor';

interface LoopConfig {
  items: any[];
  batchSize: number;
  parallel: boolean;
  continueOnError: boolean;
  throttleMs: number;
}

// Utility function for throttle delays
const sleep = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

// Helper to collect subgraph from loop node
function collectSubgraph(nodes: Node[], edges: Edge[], startNodeId: string): Edge[] {
  const visited = new Set<string>();
  const stack = [startNodeId];
  const subgraphEdges: Edge[] = [];
  
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    
    for (const edge of edges.filter(e => e.source === currentId)) {
      if (!visited.has(edge.target)) {
        visited.add(edge.target);
        subgraphEdges.push(edge);
        stack.push(edge.target);
      }
    }
  }
  
  return subgraphEdges;
}

// Main centralized loop execution function
export async function handleN8NLoopExecution(
  context: ExecutionContext,
  loopNodeId: string,
  loopConfig: LoopConfig,
  outgoingEdges: Edge[],
  globalExecuted: Set<string>
): Promise<void> {
  const { items, batchSize, parallel, continueOnError, throttleMs } = loopConfig;
  
  console.log(`🔄 [N8N LOOP] Starting execution for ${items.length} items, batchSize: ${batchSize}, parallel: ${parallel}`);
  
  // Collect the subgraph once at the beginning
  const subgraphEdges = collectSubgraph(context.nodes, context.edges, loopNodeId);
  console.log(`🔄 [N8N LOOP] Subgraph has ${subgraphEdges.length} edges`);
  
  // Chunk items into batches
  const batches: any[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  
  console.log(`🔄 [N8N LOOP] Created ${batches.length} batches`);
  
  // Process each batch
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    
    // Apply throttle delay between batches (not on first batch)
    if (throttleMs > 0 && batchIndex > 0) {
      console.log(`⏱️ [N8N LOOP] Throttling for ${throttleMs}ms before batch ${batchIndex + 1}`);
      await sleep(throttleMs);
    }
    
    console.log(`🔄 [N8N LOOP] Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} items`);
    
    if (parallel) {
      // Parallel processing within the batch
      await Promise.allSettled(
        batch.map(async (item, localIndex) => {
          const absoluteIndex = batchIndex * batchSize + localIndex;
          try {
            await processSingleItem(
              context,
              loopNodeId,
              item,
              absoluteIndex,
              items,
              outgoingEdges,
              subgraphEdges,
              globalExecuted
            );
          } catch (error) {
            console.error(`❌ [N8N LOOP] Error processing item ${absoluteIndex}:`, error);
            if (!continueOnError) {
              throw error;
            }
          }
        })
      );
    } else {
      // Serial processing within the batch
      for (let localIndex = 0; localIndex < batch.length; localIndex++) {
        const item = batch[localIndex];
        const absoluteIndex = batchIndex * batchSize + localIndex;
        
        try {
          await processSingleItem(
            context,
            loopNodeId,
            item,
            absoluteIndex,
            items,
            outgoingEdges,
            subgraphEdges,
            globalExecuted
          );
        } catch (error) {
          console.error(`❌ [N8N LOOP] Error processing item ${absoluteIndex}:`, error);
          if (!continueOnError) {
            throw error;
          }
        }
      }
    }
  }
  
  // Final cleanup - reset loop node state
  console.log(`🔄 [N8N LOOP] Cleaning up loop node state`);
  context.setNodes(nodes =>
    nodes.map(n =>
      n.id === loopNodeId
        ? {
            ...n,
            data: {
              ...n.data,
              loopItems: undefined,
              loopIndex: undefined,
              loopItem: undefined,
              output: undefined,
            },
          }
        : n
    )
  );
  
  console.log(`✅ [N8N LOOP] Completed processing ${items.length} items in ${batches.length} batches`);
}

// Process a single item within the loop context
async function processSingleItem(
  context: ExecutionContext,
  loopNodeId: string,
  item: any,
  itemIndex: number,
  allItems: any[],
  outgoingEdges: Edge[],
  subgraphEdges: Edge[],
  globalExecuted: Set<string>
): Promise<void> {
  console.log(`🔄 [N8N LOOP] Processing item ${itemIndex}: ${JSON.stringify(item).slice(0, 100)}...`);
  
  // Set loop context on the loop node and downstream nodes
  context.setNodes(nodes =>
    nodes.map(n => {
      if (n.id === loopNodeId) {
        return {
          ...n,
          data: {
            ...n.data,
            loopItems: allItems,
            loopIndex: itemIndex,
            loopItem: item,
            output: item,
          },
        };
      }
      
      // Set loop context on immediate downstream nodes
      const isImmediateDownstream = outgoingEdges.some(edge => edge.target === n.id);
      if (isImmediateDownstream) {
        return {
          ...n,
          data: {
            ...n.data,
            loopItem: item,
            loopIndex: itemIndex,
            input: item,
            lastUpdated: new Date().toISOString(),
          },
        };
      }
      
      return n;
    })
  );
  
  // Execute the subgraph for this item using BFS traversal
  const queue = outgoingEdges.map(edge => edge.target);
  const executedInIteration = new Set<string>([loopNodeId]);
  const failedNodes = new Set<string>();
  const retryCount = new Map<string, number>();
  const MAX_RETRIES = context.nodes.length * 2;
  
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    
    if (executedInIteration.has(nodeId) || failedNodes.has(nodeId)) {
      continue;
    }
    
    // Check if all incoming dependencies are satisfied within this subgraph
    const incomingInSubgraph = subgraphEdges.filter(e => e.target === nodeId);
    const unsatisfiedDeps = incomingInSubgraph.filter(e => 
      !executedInIteration.has(e.source) && !failedNodes.has(e.source)
    );
    
    if (unsatisfiedDeps.length > 0) {
      // Not ready yet, add back to queue with retry limit
      const retries = (retryCount.get(nodeId) || 0) + 1;
      if (retries >= MAX_RETRIES) {
        console.error(`❌ [N8N LOOP] Max retries exceeded for node ${nodeId}`);
        failedNodes.add(nodeId);
        continue;
      }
      retryCount.set(nodeId, retries);
      queue.push(nodeId);
      continue;
    }
    
    // Execute this node
    try {
      console.log(`🎯 [N8N LOOP] Executing node ${nodeId} for item ${itemIndex}`);
      await context.executeNode?.(nodeId, new Set([...globalExecuted, ...executedInIteration]));
      executedInIteration.add(nodeId);
      
      // Add children to queue
      const childNodes = subgraphEdges
        .filter(e => e.source === nodeId)
        .map(e => e.target)
        .filter(targetId => !queue.includes(targetId) && !executedInIteration.has(targetId));
      
      queue.push(...childNodes);
      
    } catch (error) {
      console.error(`❌ [N8N LOOP] Error executing node ${nodeId} for item ${itemIndex}:`, error);
      failedNodes.add(nodeId);
      // Continue processing other nodes unless continueOnError is false
    }
  }
  
  console.log(`✅ [N8N LOOP] Completed processing item ${itemIndex}, executed ${executedInIteration.size} nodes`);
}