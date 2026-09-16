import { createError } from "../middleware/errorHandler";

interface ClusterDocument {
  nodes: Array<{ id?: unknown }>;
  edges: Array<{ id?: unknown; source?: unknown; target?: unknown }>;
  node_clusters: Array<{ id: string; title: string; memberNodeIds: string[] }>;
}

/** Final API boundary check. UI validation is advisory; persisted membership is not. */
export function validateNodeClusterDocument(document: ClusterDocument): void {
  const nodeIds = new Set(document.nodes.map(({ id }) => id).filter((id): id is string => typeof id === "string"));
  const clusterIds = new Set<string>();
  const titles = new Set<string>();
  const owners = new Set<string>();

  for (const cluster of document.node_clusters) {
    const normalizedTitle = cluster.title.trim().toLocaleLowerCase();
    if (clusterIds.has(cluster.id)) throw createError("duplicate-cluster-id", 400);
    if (titles.has(normalizedTitle)) throw createError("duplicate-title", 400);
    clusterIds.add(cluster.id);
    titles.add(normalizedTitle);
    for (const nodeId of cluster.memberNodeIds) {
      if (!nodeIds.has(nodeId)) throw createError(`missing-member: ${nodeId}`, 400);
      if (owners.has(nodeId)) throw createError(`overlapping-membership: ${nodeId}`, 400);
      owners.add(nodeId);
    }
  }
}
