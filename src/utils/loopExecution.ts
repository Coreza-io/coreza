import type { Edge, Node } from '@xyflow/react';
import type { ExecutionContext } from './workflowExecutor';

function collectSubgraph(nodes: Node[], edges: Edge[], startId: string): Edge[] {
  const seen = new Set<string>();
  const stack = [startId];
  const sub: Edge[] = [];
  while (stack.length) {
    const src = stack.pop()!;
    for (const e of edges.filter(e => e.source === src)) {
      if (!seen.has(e.target)) {
        seen.add(e.target);
        sub.push(e);
        stack.push(e.target);
      }
    }
  }
  return sub;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function handleLoopExecution(
  context: ExecutionContext,
  loopNodeId: string,
  inputData: any,
  outgoing: Edge[],
  executedSet: Set<string>
): Promise<void> {
  const { items = [], batchSize = 1, parallel = false, throttleMs = 0, continueOnError = false } = inputData;

  context.setNodes(ns =>
    ns.map(n => (n.id === loopNodeId ? { ...n, data: { ...n.data, loopItems: items } } : n))
  );

  const subgraphEdges = collectSubgraph(context.nodes, context.edges, loopNodeId);
  const getChildren = (id: string) => subgraphEdges.filter(e => e.source === id).map(e => e.target);

  const batches: any[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    if (throttleMs > 0 && batchIndex > 0) {
      await sleep(throttleMs);
    }

    if (parallel) {
      await Promise.all(
        batch.map((item, idx) =>
          processSingleItem(item, batchIndex * batchSize + idx).catch(err => {
            if (!continueOnError) throw err;
          })
        )
      );
    } else {
      for (let idx = 0; idx < batch.length; idx++) {
        try {
          await processSingleItem(batch[idx], batchIndex * batchSize + idx);
        } catch (err) {
          if (!continueOnError) throw err;
        }
      }
    }
  }

  context.setNodes(ns =>
    ns.map(n =>
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

  async function processSingleItem(item: any, absoluteIndex: number) {
    console.log(`🔁 Processing loop item ${absoluteIndex + 1}/${items.length}`);
    context.setNodes(ns =>
      ns.map(n =>
        n.id === loopNodeId
          ? {
              ...n,
              data: { ...n.data, loopItems: items, loopIndex: absoluteIndex, loopItem: item, output: item },
            }
          : n
      )
    );

    const queue = outgoing.map(e => e.target);
    const seen = new Set<string>();
    while (queue.length) {
      const nextId = queue.shift()!;
      if (seen.has(nextId)) continue;
      seen.add(nextId);
      await context.executeNode?.(nextId, executedSet);
      queue.push(...getChildren(nextId));
    }
  }
}
