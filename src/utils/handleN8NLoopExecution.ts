import { Edge, Node } from '@xyflow/react';
import ExecutionContext from './executionContext';
import { resolveReferences } from '@/utils/resolveReferences'; // Use your actual path

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function collectSubgraph(nodes: Node[], edges: Edge[], start: string): Edge[] {
  const visited = new Set<string>();
  const stack = [start];
  const subEdges: Edge[] = [];
  while (stack.length) {
    const cur = stack.pop()!;
    edges.filter(e => e.source === cur).forEach(e => {
      if (!visited.has(e.target)) {
        visited.add(e.target);
        subEdges.push(e);
        stack.push(e.target);
      }
    });
  }
  return subEdges;
}

// If you want to deeply resolve objects/arrays, include this helper:
function resolveDeep(val: any, selectedInputData: any, allNodeData: any, nodes: Node[]): any {
  if (typeof val === "string") {
    return resolveReferences(val, selectedInputData, allNodeData, nodes);
  }
  if (Array.isArray(val)) {
    return val.map(v => resolveDeep(v, selectedInputData, allNodeData, nodes));
  }
  if (typeof val === "object" && val !== null) {
    return Object.fromEntries(
      Object.entries(val).map(([k, v]) => [k, resolveDeep(v, selectedInputData, allNodeData, nodes)])
    );
  }
  return val;
}

export async function handleN8NLoopExecution(
  execCtx: ExecutionContext,
  graph: { nodes: Node[]; edges: Edge[] },
  loopNodeId: string,
  fieldState,
  outgoing: Edge[],
  globalExecuted: Set<string>,
  executeNode: (id: string, executed: Set<string>) => Promise<any>
): Promise<void> {
  // --- Resolve node context for references ---
  const nodes = graph.nodes;
  const loopNode = nodes.find(n => n.id === loopNodeId);
  // Get previous (upstream) nodes for context:
  const previousNodes = nodes.filter(n =>
    graph.edges.some(e => e.target === loopNodeId && e.source === n.id)
  );
  const allNodeData: Record<string, any> = {};
  previousNodes.forEach(prevNode => {
    // Use store, not node.data!
    let nodeData = execCtx.getNodeData(prevNode.id).output ?? {};
    if (Array.isArray(nodeData) && nodeData.length > 0) {
      nodeData = nodeData || {};
    }
    allNodeData[prevNode.id] = nodeData;
  });
  const selectedInputData =
  previousNodes[0] ? execCtx.getNodeData(previousNodes[0].id).output ?? {} : {};

  // --- Resolve all relevant fieldState values (deep!) ---
  // If your fieldState keys are named differently, adjust here.
  let items = resolveDeep(fieldState.inputArray, selectedInputData, allNodeData, nodes) || [];
  const parsed = JSON.parse(items);
  items = Array.isArray(parsed) ? parsed : [parsed];
  const batchSize: number = parseInt(resolveDeep(fieldState.batchSize, selectedInputData, allNodeData, nodes)) || 1;
  const parallel: boolean = !!resolveDeep(fieldState.parallel, selectedInputData, allNodeData, nodes);
  const continueOnError: boolean = !!resolveDeep(fieldState.continueOnError, selectedInputData, allNodeData, nodes);
  const throttleMs: number = parseInt(resolveDeep(fieldState.throttleMs, selectedInputData, allNodeData, nodes)) || 0;

  const subgraph = collectSubgraph(nodes, graph.edges, loopNodeId);

  const batches: any[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  for (let bi = 0; bi < batches.length; bi++) {
    if (bi > 0 && throttleMs > 0) await sleep(throttleMs);
    const batch = batches[bi];

    const runner = async (item: any, li: number) => {
      const absoluteIndex = bi * batchSize + li;

      execCtx.setNodeData(loopNodeId, {
        loopItems: items,
        loopIndex: absoluteIndex,
        loopItem: item,
        output: item,
      });
      outgoing.forEach(e => {
        execCtx.setNodeData(e.target, {
          input: item,
          loopItem: item,
          loopIndex: absoluteIndex,
        });
      });

      const queue = outgoing.map(e => e.target);
      const done = new Set<string>([loopNodeId]);
      const failures = new Set<string>();
      const retries = new Map<string, number>();
      const MAX_RETRY = nodes.length * 2;

      while (queue.length) {
        const nid = queue.shift()!;
        if (done.has(nid) || failures.has(nid)) continue;

        const deps = subgraph.filter(e => e.target === nid);
        const unmet = deps.filter(e => !done.has(e.source) && !failures.has(e.source));
        if (unmet.length) {
          const count = (retries.get(nid) || 0) + 1;
          if (count >= MAX_RETRY) {
            failures.add(nid);
            continue;
          }
          retries.set(nid, count);
          queue.push(nid);
          continue;
        }

        try {
          await executeNode(nid, new Set([...globalExecuted, ...done]));
          done.add(nid);
          subgraph
            .filter(e => e.source === nid)
            .map(e => e.target)
            .forEach(t => {
              if (!queue.includes(t)) queue.push(t);
            });
        } catch (err) {
          failures.add(nid);
          if (!continueOnError) throw err;
        }
      }
    };

    if (parallel) {
      await Promise.all(
        batch.map((it, idx) =>
          runner(it, idx).catch(err => {
            if (!continueOnError) throw err;
          })
        )
      );
    } else {
      for (let i = 0; i < batch.length; i++) {
        await runner(batch[i], i);
      }
    }
  }

  execCtx.setNodeData(loopNodeId, {
    loopItems: undefined,
    loopIndex: undefined,
    loopItem: undefined,
    output: undefined,
  });
}
