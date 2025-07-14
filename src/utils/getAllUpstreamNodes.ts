import type { Node, Edge } from '@xyflow/react';

export const getAllUpstreamNodes = (nodeId: string, edges: Edge[], nodes: Node[]): Node[] => {
  const upstreamEdges = edges.filter(e => e.target === nodeId);
  return upstreamEdges
    .map(e => nodes.find(n => n.id === e.source))
    .filter(Boolean) as Node[];
};