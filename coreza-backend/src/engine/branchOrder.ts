type BranchNode = {
  id: string;
  name?: unknown;
  node_type?: unknown;
  values?: { checkDependency?: unknown };
};

type BranchEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  data?: Record<string, unknown>;
};

type LinearBranch<E> = { firstEdge: E; nodeIds: string[] };
type LinearBranchGroup<E> = { branches: LinearBranch<E>[]; joinId: string };
type BranchPriority = { fork: string; order: number };
export type BranchOrders = ReadonlyMap<string, BranchPriority>;
export type OrderedBranches = { priorities: BranchOrders; joinIds: ReadonlySet<string> };

export function readBranchOrder(data: BranchEdge["data"]): number | undefined {
  const order = data?.branchOrder;
  if (typeof order === "number" && Number.isSafeInteger(order) && order > 0) return order;
}

const isRegular = (node: BranchNode | undefined) =>
  node?.node_type === "main" && node.name !== "If" && node.name !== "Switch" && node.name !== "Loop";

export function findLinearBranchGroups<E extends BranchEdge>(
  nodes: readonly BranchNode[],
  edges: readonly E[],
  forkIds: ReadonlySet<string>,
): LinearBranchGroup<E>[] {
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const outgoing = new Map<string, E[]>();
  const inDegree = new Map<string, number>();
  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target || source.node_type === "sub" || target.node_type === "sub") continue;
    const siblings = outgoing.get(edge.source) ?? [];
    siblings.push(edge);
    outgoing.set(edge.source, siblings);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const groups: LinearBranchGroup<E>[] = [];
  for (const forkId of forkIds) {
    if (!isRegular(nodeById.get(forkId))) continue;
    const byHandle = new Map<string, E[]>();
    for (const edge of outgoing.get(forkId) ?? []) {
      const handle = edge.sourceHandle ?? "";
      const siblings = byHandle.get(handle) ?? [];
      siblings.push(edge);
      byHandle.set(handle, siblings);
    }
    for (const siblings of byHandle.values()) {
      if (siblings.length < 2) continue;
      const visited = new Set([forkId]);
      const branches: LinearBranch<E>[] = [];
      let joinId: string | undefined;
      for (const firstEdge of siblings) {
        const nodeIds: string[] = [];
        let id = firstEdge.target;
        while (isRegular(nodeById.get(id)) && !visited.has(id) && inDegree.get(id) === 1) {
          const next = outgoing.get(id);
          if (next?.length !== 1) break;
          visited.add(id);
          nodeIds.push(id);
          id = next[0].target;
        }
        const join = nodeById.get(id);
        if (!nodeIds.length || visited.has(id) || join?.node_type !== "main" ||
            join.name === "Loop" || join.values?.checkDependency ||
            inDegree.get(id) !== siblings.length || (joinId !== undefined && joinId !== id)) break;
        joinId = id;
        branches.push({ firstEdge, nodeIds });
      }
      if (branches.length === siblings.length && joinId !== undefined) groups.push({ branches, joinId });
    }
  }
  return groups;
}

export function buildBranchOrders(
  nodes: readonly BranchNode[],
  edges: readonly BranchEdge[],
): OrderedBranches | undefined {
  const forkIds = new Set<string>();
  for (const edge of edges) {
    if (readBranchOrder(edge.data) !== undefined) forkIds.add(edge.source);
  }
  if (!forkIds.size) return;

  const priorities = new Map<string, BranchPriority>();
  const joinIds = new Set<string>();
  for (const { branches, joinId } of findLinearBranchGroups(nodes, edges, forkIds)) {
    const orders = branches.map(({ firstEdge }) => readBranchOrder(firstEdge.data));
    if (orders.includes(undefined) || new Set(orders).size !== orders.length) continue;
    const fork = branches[0].firstEdge.id;
    joinIds.add(joinId);
    branches.forEach(({ nodeIds }, index) => {
      for (const id of nodeIds) priorities.set(id, { fork, order: orders[index]! });
    });
  }
  if (priorities.size) return { priorities, joinIds };
}

export function orderedReadyIndex<T>(
  queue: readonly T[],
  head: number,
  priorities: BranchOrders,
  nodeId: (item: T) => string,
  sameIteration?: (headItem: T, candidate: T) => boolean,
): number {
  const headItem = queue[head];
  const first = priorities.get(nodeId(headItem));
  if (!first || first.order === 1) return head;

  let bestIndex = head;
  let bestOrder = first.order;
  // Only work from the head's fork and iteration can move ahead of it.
  for (let index = head + 1; index < queue.length; index++) {
    const item = queue[index];
    const priority = priorities.get(nodeId(item));
    if (priority?.fork !== first.fork || priority.order >= bestOrder ||
        (sameIteration && !sameIteration(headItem, item))) continue;
    bestIndex = index;
    bestOrder = priority.order;
    if (bestOrder === 1) break;
  }
  return bestIndex;
}
