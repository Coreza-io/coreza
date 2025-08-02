import type { Edge, Node } from '@xyflow/react';
import type { ExecutionContext } from './workflowExecutor';

export async function handleLoopExecution(
  context: ExecutionContext,
  loopNodeId: string,
  result: any,
  outgoing: Edge[],
  globalExecuted: Set<string>
): Promise<void> {
  const { items = [], continueOnError = false } = result;

  context.setNodes(ns =>
    ns.map(n =>
      n.id === loopNodeId
        ? { ...n, data: { ...n.data, loopItems: items } }
        : n
    )
  );

  const subgraphEdges = collectSubgraph(context.nodes, context.edges, loopNodeId);

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];

    context.setNodes(ns =>
      ns.map(n =>
        n.id === loopNodeId
          ? {
              ...n,
              data: { ...n.data, loopItem: item, loopIndex: idx, output: item },
            }
          : n
      )
    );

    const queue = outgoing.map(e => e.target);
    const executed = new Set<string>([loopNodeId]);
    const failed = new Set<string>();
    const retryCnt = new Map<string, number>();
    const MAX_RETRIES = context.nodes.length * 2;

    while (queue.length) {
      const id = queue.shift()!;
      if (executed.has(id) || failed.has(id)) continue;

      const incoming = subgraphEdges.filter(e => e.target === id);
      const missing = incoming.filter(e => !executed.has(e.source) && !failed.has(e.source));
      if (missing.length) {
        const tries = (retryCnt.get(id) || 0) + 1;
        if (tries >= MAX_RETRIES) {
          failed.add(id);
          continue;
        }
        retryCnt.set(id, tries);
        queue.push(id);
        continue;
      }

      try {
        await context.executeNode?.(id, new Set([...globalExecuted, ...executed]));
        executed.add(id);
      } catch (err) {
        if (!continueOnError) throw err;
        failed.add(id);
      }

      const children = subgraphEdges
        .filter(e => e.source === id)
        .map(e => e.target)
        .filter(t => !queue.includes(t) && !executed.has(t));
      queue.push(...children);
    }
  }

  context.setNodes(ns =>
    ns.map(n =>
      n.id === loopNodeId
        ? {
            ...n,
            data: {
              ...n.data,
              output: n.data.originalOutput,
              loopItem: undefined,
              loopIndex: undefined,
              loopItems: undefined,
            },
          }
        : n
    )
  );
}

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
