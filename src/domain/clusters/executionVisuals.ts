import type { Edge, Node } from "@xyflow/react";
import type { ClusterActiveMember } from "@/hooks/useClusterExecution";
import type { NodeCluster } from "./types";
import { getClusterEdgeKind } from "./edgeSemantics";

/** Render-only copies, always derived from the unmodified displayed graph. */
export function applyClusterExecutionVisuals(
  nodes: Node[],
  edges: Edge[],
  canonicalNodes: readonly Node[],
  canonicalEdges: readonly Edge[],
  clusters: readonly NodeCluster[],
  active: ClusterActiveMember | null,
  expanded: boolean,
): { nodes: Node[]; edges: Edge[] } {
  const cluster = active && clusters.find(({ id }) => id === active.clusterId);
  if (!active || !cluster?.memberNodeIds.includes(active.nodeId) ||
    !canonicalNodes.some(({ id }) => id === active.nodeId)) return { nodes, edges };

  let nodeChanged = false;
  const nextNodes = nodes.map((node) => {
    if (node.id !== active.nodeId || node.data.isExecuting === true) return node;
    nodeChanged = true;
    // Hidden runtime hosts keep all their display and interaction flags.
    return { ...node, data: { ...node.data, isExecuting: true } };
  });
  if (!expanded) return { nodes: nodeChanged ? nextNodes : nodes, edges };

  const members = new Set(cluster.memberNodeIds);
  const nodeById = new Map(canonicalNodes.map((node) => [node.id, node]));
  const incidentEdges = new Map(canonicalEdges.filter((edge) =>
    members.has(edge.source) && members.has(edge.target) &&
    (edge.source === active.nodeId || edge.target === active.nodeId) &&
    getClusterEdgeKind(edge, nodeById.get(edge.source), nodeById.get(edge.target)) === "main",
  ).map((edge) => [edge.id, edge]));
  let edgeChanged = false;
  const nextEdges = edges.map((edge) => {
    const canonical = incidentEdges.get(edge.id);
    if (edge.hidden || !canonical || edge.source !== canonical.source || edge.target !== canonical.target ||
      edge.sourceHandle !== canonical.sourceHandle || edge.targetHandle !== canonical.targetHandle) return edge;
    edgeChanged = true;
    const className = edge.className?.split(/\s+/).includes("executing-edge")
      ? edge.className : [edge.className, "executing-edge"].filter(Boolean).join(" ");
    return {
      ...edge,
      animated: true,
      className,
      style: { ...edge.style, stroke: "var(--execution-edge-color)", strokeWidth: 3,
        strokeLinecap: "round" as const, strokeLinejoin: "round" as const },
    };
  });
  return { nodes: nodeChanged ? nextNodes : nodes, edges: edgeChanged ? nextEdges : edges };
}
