import { WorkflowNode, WorkflowEdge } from '../services/workflowEngine';
import { resolveReferences } from './resolveReferences';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function collectSubgraph(nodes: WorkflowNode[], edges: WorkflowEdge[], start: string): WorkflowEdge[] {
  const visited = new Set<string>();
  const stack = [start];
  const subEdges: WorkflowEdge[] = [];
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

// Deep resolve helper for complex data structures
function resolveDeep(val: any, selectedInputData: any, allNodeData: any, nodes: WorkflowNode[]): any {
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
  workflowEngine: any, // The workflow engine instance
  graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[] },
  loopNodeId: string,
  fieldState: any,
  outgoing: WorkflowEdge[],
  globalExecuted: Set<string>,
  executeNode: (nodeId: string, executed: Set<string>) => Promise<any>
): Promise<void> {
  console.log(`🔄 [BACKEND] Starting N8N-style loop execution for node: ${loopNodeId}`);

  // --- Resolve node context for references ---
  const nodes = graph.nodes;
  const loopNode = nodes.find(n => n.id === loopNodeId);
  
  // Get previous (upstream) nodes for context:
  const previousNodes = nodes.filter(n =>
    graph.edges.some(e => e.target === loopNodeId && e.source === n.id)
  );
  
  const allNodeData: Record<string, any> = {};
  previousNodes.forEach(prevNode => {
    // Get node results from workflow engine
    const nodeData = workflowEngine.getNodeResult(prevNode.id) ?? {};
    allNodeData[prevNode.id] = nodeData;
  });
  
  const selectedInputData = previousNodes[0] ? workflowEngine.getNodeResult(previousNodes[0].id) ?? {} : {};

  // --- Resolve all relevant fieldState values (deep!) ---
  let items = resolveDeep(fieldState.inputArray, selectedInputData, allNodeData, nodes) || [];
  
  // Parse items if it's a JSON string
  try {
    if (typeof items === 'string') {
      const parsed = JSON.parse(items);
      items = Array.isArray(parsed) ? parsed : [parsed];
    } else if (!Array.isArray(items)) {
      items = items ? [items] : [];
    }
  } catch (e) {
    console.warn(`⚠️ [BACKEND] Failed to parse loop items, using as-is:`, items);
    items = Array.isArray(items) ? items : [items];
  }

  const batchSize: number = parseInt(resolveDeep(fieldState.batchSize, selectedInputData, allNodeData, nodes)) || 1;
  const parallel: boolean = !!resolveDeep(fieldState.parallel, selectedInputData, allNodeData, nodes);
  const continueOnError: boolean = !!resolveDeep(fieldState.continueOnError, selectedInputData, allNodeData, nodes);
  const throttleMs: number = parseInt(resolveDeep(fieldState.throttleMs, selectedInputData, allNodeData, nodes)) || 200;

  console.log(`🔄 [BACKEND] Loop configuration:`, {
    itemsCount: items.length,
    batchSize,
    parallel,
    continueOnError,
    throttleMs
  });

  const subgraph = collectSubgraph(nodes, graph.edges, loopNodeId);

  // Collect results from nodes that route back to the loop node
  const loopResults: any[] = [];

  // Create batches
  const batches: any[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  console.log(`🔄 [BACKEND] Processing ${batches.length} batches`);

  // Process each batch
  for (let bi = 0; bi < batches.length; bi++) {
    if (bi > 0 && throttleMs > 0) {
      console.log(`⏱️ [BACKEND] Throttling for ${throttleMs}ms between batches`);
      await sleep(throttleMs);
    }
    
    const batch = batches[bi];
    console.log(`🔄 [BACKEND] Processing batch ${bi + 1}/${batches.length} with ${batch.length} items`);

    const runner = async (item: any, li: number) => {
      const absoluteIndex = bi * batchSize + li;
      console.log(`🔄 [BACKEND] Processing item ${absoluteIndex + 1}/${items.length}:`, item);

      // Set loop context in workflow engine
      workflowEngine.setLoopContext(loopNodeId, {
        loopItems: items,
        loopIndex: absoluteIndex,
        loopItem: item,
        output: item,
      });

      // Set context for target nodes
      outgoing.forEach(e => {
        workflowEngine.setLoopContext(e.target, {
          input: item,
          loopItem: item,
          loopIndex: absoluteIndex,
        });
      });

      // Execute subgraph for this item
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
            console.error(`❌ [BACKEND] Node ${nid} exceeded retry limit (${MAX_RETRY}), marking as failed`);
            failures.add(nid);
            continue;
          }
          retries.set(nid, count);
          queue.push(nid);
          continue;
        }

        try {
          console.log(`⚡ [BACKEND] Executing loop subgraph node: ${nid}`);
          await executeNode(nid, new Set([...globalExecuted, ...done]));
          done.add(nid);

          // Capture results from nodes that feed back into the loop
          graph.edges
            .filter(e => e.source === nid && e.target === loopNodeId)
            .forEach(() => {
              loopResults.push(workflowEngine.getNodeResult(nid));
            });

          // Add downstream nodes to queue
          subgraph
            .filter(e => e.source === nid)
            .map(e => e.target)
            .forEach(t => {
              if (!queue.includes(t)) queue.push(t);
            });
        } catch (err) {
          console.error(`❌ [BACKEND] Failed to execute node ${nid} in loop:`, err);
          failures.add(nid);
          if (!continueOnError) throw err;
        }
      }
    };

    // Execute batch items
    if (parallel) {
      console.log(`🚀 [BACKEND] Executing batch in parallel`);
      await Promise.all(
        batch.map((it, idx) =>
          runner(it, idx).catch(err => {
            console.error(`❌ [BACKEND] Parallel execution failed for item ${idx}:`, err);
            if (!continueOnError) throw err;
          })
        )
      );
    } else {
      console.log(`📝 [BACKEND] Executing batch sequentially`);
      for (let i = 0; i < batch.length; i++) {
        try {
          await runner(batch[i], i);
        } catch (err) {
          console.error(`❌ [BACKEND] Sequential execution failed for item ${i}:`, err);
          if (!continueOnError) throw err;
        }
      }
    }
  }

  // Store aggregated results as the loop node's final output
  (workflowEngine as any).nodeResults.set(loopNodeId, { success: true, data: loopResults });

  // Clear loop context
  workflowEngine.clearLoopContext(loopNodeId);
  console.log(`✅ [BACKEND] N8N-style loop execution completed for node: ${loopNodeId}`);
}