import type { Edge, Node } from "@xyflow/react";
import type { NodeCluster } from "./types";
import { normalizeClusters, validateClusters } from "./validate";

export interface WorkflowDocument {
  nodes: Node[];
  edges: Edge[];
  clusters: NodeCluster[];
}

export interface DocumentMutationResult {
  document: WorkflowDocument;
  dissolvedClusters: NodeCluster[];
}

const cloneDocument = (document: WorkflowDocument): WorkflowDocument => ({
  nodes: document.nodes.map((node) => ({ ...node, data: { ...node.data } })),
  edges: document.edges.map((edge) => ({ ...edge, data: { ...edge.data } })),
  clusters: document.clusters.map((cluster) => ({ ...cluster, memberNodeIds: [...cluster.memberNodeIds] })),
});

/**
 * Applies a graph mutation as a single document transaction. Invalid cluster
 * metadata is dissolved rather than allowing ordinary graph edits to strand it.
 */
export function mutateDocument(
  current: WorkflowDocument,
  mutate: (candidate: WorkflowDocument) => void,
): DocumentMutationResult {
  const candidate = cloneDocument(current);
  const invalidBefore = new Set(
    validateClusters(current.nodes, current.edges, current.clusters).violations
      .flatMap((item) => item.clusterId ? [item.clusterId] : []),
  );
  mutate(candidate);
  candidate.clusters = normalizeClusters(candidate.clusters);

  const validation = validateClusters(candidate.nodes, candidate.edges, candidate.clusters);
  const newlyInvalidClusterIds = new Set(
    validation.violations.flatMap((item) =>
      item.clusterId && !invalidBefore.has(item.clusterId) ? [item.clusterId] : []),
  );
  const dissolvedClusters = candidate.clusters.filter((cluster) => newlyInvalidClusterIds.has(cluster.id));
  candidate.clusters = candidate.clusters.filter((cluster) => !newlyInvalidClusterIds.has(cluster.id));
  return { document: candidate, dissolvedClusters };
}

export function deleteNodesFromDocument(
  current: WorkflowDocument,
  nodeIds: ReadonlySet<string>,
): DocumentMutationResult {
  return mutateDocument(current, (candidate) => {
    candidate.nodes = candidate.nodes.filter((node) => !nodeIds.has(node.id));
    candidate.edges = candidate.edges.filter((edge) => !nodeIds.has(edge.source) && !nodeIds.has(edge.target));
    candidate.clusters = candidate.clusters
      .map((cluster) => ({
        ...cluster,
        memberNodeIds: cluster.memberNodeIds.filter((id) => !nodeIds.has(id)),
      }))
      .filter((cluster) => cluster.memberNodeIds.length > 0);
  });
}

export function renameNodeInDocument(
  current: WorkflowDocument,
  oldId: string,
  newId: string,
): DocumentMutationResult {
  if (current.nodes.some((node) => node.id === newId)) throw new Error(`Node ${newId} already exists.`);
  return mutateDocument(current, (candidate) => {
    candidate.nodes = candidate.nodes.map((node) => node.id === oldId ? { ...node, id: newId } : node);
    candidate.edges = candidate.edges.map((edge) => ({
      ...edge,
      source: edge.source === oldId ? newId : edge.source,
      target: edge.target === oldId ? newId : edge.target,
    }));
    candidate.clusters = candidate.clusters.map((cluster) => ({
      ...cluster,
      memberNodeIds: cluster.memberNodeIds.map((id) => id === oldId ? newId : id),
    }));
  });
}
