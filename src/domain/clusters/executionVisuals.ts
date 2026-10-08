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
  if (!active || !cluster?.memberNodeIds.includes(active.nodeId)) return { nodes, edges };
  return applyNodeExecutionVisuals(nodes, edges, canonicalNodes, canonicalEdges,
    active.nodeId, expanded, cluster.memberNodeIds);
}

/** Shared effects for a normal node action, optionally scoped to a cluster. */
export function applyNodeExecutionVisuals(
  nodes: Node[],
  edges: Edge[],
  canonicalNodes: readonly Node[],
  canonicalEdges: readonly Edge[],
  nodeId: string | null,
  animateEdges = true,
  memberNodeIds?: readonly string[],
): { nodes: Node[]; edges: Edge[] } {
  if (!nodeId || !canonicalNodes.some(({ id }) => id === nodeId)) return { nodes, edges };
  let nodeChanged = false;
  const nextNodes = nodes.map((node) => {
    if (node.id !== nodeId || node.data.isExecuting === true) return node;
    nodeChanged = true;
    // Hidden runtime hosts keep all their display and interaction flags.
    return { ...node, data: { ...node.data, isExecuting: true } };
  });
  if (!animateEdges) return { nodes: nodeChanged ? nextNodes : nodes, edges };

  const members = memberNodeIds ? new Set(memberNodeIds) : null;
  const nodeById = new Map(canonicalNodes.map((node) => [node.id, node]));
  const incidentEdges = new Map(canonicalEdges.filter((edge) =>
    (!members || (members.has(edge.source) && members.has(edge.target))) &&
    (edge.source === nodeId || edge.target === nodeId) &&
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
