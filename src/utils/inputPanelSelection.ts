interface InputNode {
  id: string;
  data: Record<string, unknown>;
}

const owns = (value: unknown, key: PropertyKey): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null && Object.prototype.hasOwnProperty.call(value, key);

export function resolvePreviousNodeId(
  selectedId: string | undefined,
  previousNodes: readonly InputNode[],
  preferredDirectId?: string,
): string | undefined {
  const upstreamIds = new Set(previousNodes.map(({ id }) => id));
  if (selectedId && upstreamIds.has(selectedId)) return selectedId;
  if (preferredDirectId && upstreamIds.has(preferredDirectId)) return preferredDirectId;
  return previousNodes[0]?.id;
}

export function getUpstreamDistances(
  nodeId: string | undefined,
  edges: readonly { source: string; target: string }[],
): Map<string, number> {
  const distances = new Map<string, number>();
  if (!nodeId) return distances;
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const sources = incoming.get(edge.target) ?? [];
    sources.push(edge.source);
    incoming.set(edge.target, sources);
  }
  distances.set(nodeId, 0);
  const queue = [nodeId];
  for (let i = 0; i < queue.length; i++) {
    for (const source of incoming.get(queue[i]) ?? []) {
      if (distances.has(source)) continue;
      distances.set(source, distances.get(queue[i])! + 1);
      queue.push(source);
    }
  }
  distances.delete(nodeId);
  return distances;
}

/** Use the complete graph inventory in both editor and history, including unexecuted branches. */
export function getPreviousNodes<T extends InputNode>(
  nodeId: string | undefined,
  nodes: readonly T[],
  edges: readonly { source: string; target: string }[],
): T[] {
  const nodesById = new Map(nodes.map(node => [node.id, node]));
  return [...getUpstreamDistances(nodeId, edges).keys()]
    .flatMap(id => nodesById.has(id) ? [nodesById.get(id)!] : []);
}

export function resolveLiveInputData(
  selectedId: string | undefined,
  nodes: readonly InputNode[],
  getExecutionData: (nodeId: string) => unknown,
): unknown {
  if (!selectedId) return {};
  const executionData = getExecutionData(selectedId);
  if (owns(executionData, "output")) return executionData.output;
  const nodeData = nodes.find(({ id }) => id === selectedId)?.data;
  if (owns(nodeData, "output")) return nodeData.output;
  if (owns(nodeData, "input")) return nodeData.input;
  return {};
}
