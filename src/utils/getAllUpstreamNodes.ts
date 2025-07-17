import type { Node, Edge } from '@xyflow/react';

export function getAllUpstreamNodes(
  currentNodeId: string,
  edges: Edge[],
  nodes: Node[],
  visited: Set<string> = new Set()
): Node[] {
  if (visited.has(currentNodeId)) return [];

  visited.add(currentNodeId);

  const incomingEdges = edges.filter(e => e.target === currentNodeId);
  let result: Node[] = [];

  for (const edge of incomingEdges) {
    const upstreamNode = nodes.find(n => n.id === edge.source);
    if (upstreamNode && !result.some(n => n.id === upstreamNode.id)) {
      result.push(upstreamNode);
      result = result.concat(getAllUpstreamNodes(upstreamNode.id, edges, nodes, visited));
    }
  }

  return result.filter((n, i, arr) => arr.findIndex(m => m.id === n.id) === i);
}
