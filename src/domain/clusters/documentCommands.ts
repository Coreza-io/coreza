import type { Edge, Node } from "@xyflow/react";
import type { NodeCluster } from "./types";
import { normalizeClusters, validateClusters } from "./validate";
import { remapNodeReferences } from "@/utils/remapNodeReferences";

export interface WorkflowDocument {
  nodes: Node[];
  edges: Edge[];
  clusters: NodeCluster[];
}

export interface DocumentMutationResult {
  document: WorkflowDocument;
  dissolvedClusters: NodeCluster[];
}

export interface RenameDocumentResult extends DocumentMutationResult {
  oldId: string;
  newId: string;
  changed: boolean;
}

export type InsertDocumentResult =
  | { ok: true; document: WorkflowDocument }
  | { ok: false; code: "duplicate-node" | "duplicate-edge" | "missing-endpoint" | "stale-cluster" | "invalid-document"; message: string };

export interface InsertDocumentRequest {
  nodes: readonly Node[];
  edges?: readonly Edge[];
  targetClusterId?: string | null;
  expandedClusterId?: string | null;
}

const cloneDocument = (document: WorkflowDocument): WorkflowDocument => ({
  nodes: document.nodes.map((node) => ({ ...node, data: { ...node.data } })),
  edges: document.edges.map((edge) => ({ ...edge, data: { ...edge.data } })),
  clusters: document.clusters.map((cluster) => ({ ...cluster, memberNodeIds: [...cluster.memberNodeIds] })),
});

/** Builds a complete insertion candidate without exposing a partially updated graph. */
export function insertNodesInDocument(
  current: WorkflowDocument,
  request: InsertDocumentRequest,
): InsertDocumentResult {
  const nodeIds = new Set(current.nodes.map(({ id }) => id));
  for (const node of request.nodes) {
    if (nodeIds.has(node.id)) return { ok: false, code: "duplicate-node", message: `Node ${node.id} already exists.` };
    nodeIds.add(node.id);
  }
  const edgeIds = new Set(current.edges.map(({ id }) => id));
  for (const edge of request.edges ?? []) {
    if (edgeIds.has(edge.id)) return { ok: false, code: "duplicate-edge", message: `Connection ${edge.id} already exists.` };
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return { ok: false, code: "missing-endpoint", message: "A generated connection references a missing node." };
    }
  }
  if (request.targetClusterId && request.targetClusterId !== request.expandedClusterId) {
    return { ok: false, code: "stale-cluster", message: "The target cluster is no longer expanded." };
  }
  if (request.targetClusterId && !current.clusters.some(({ id }) => id === request.targetClusterId)) {
    return { ok: false, code: "stale-cluster", message: "The target cluster no longer exists." };
  }

  const candidate = cloneDocument(current);
  candidate.nodes.push(...request.nodes.map((node) => ({ ...node, data: { ...node.data } })));
  candidate.edges.push(...(request.edges ?? []).map((edge) => ({ ...edge, data: { ...edge.data } })));
  if (request.targetClusterId) {
    const additions = request.nodes.map(({ id }) => id);
    candidate.clusters = candidate.clusters.map((cluster) => cluster.id === request.targetClusterId
      ? { ...cluster, memberNodeIds: [...cluster.memberNodeIds, ...additions.filter((id) => !cluster.memberNodeIds.includes(id))] }
      : cluster);
  }
  const validation = validateClusters(candidate.nodes, candidate.edges, candidate.clusters);
  if (!validation.valid) return { ok: false, code: "invalid-document", message: validation.violations[0].message };
  return { ok: true, document: candidate };
}

/** Applies a clipboard batch and its metadata as one validated document. */
export function pasteNodesInDocument(
  current: WorkflowDocument,
  request: InsertDocumentRequest & { idMap: Readonly<Record<string, string>>; copiedClusters: readonly NodeCluster[] },
): InsertDocumentResult {
  const tokens = Object.keys(request.idMap).map((id) => [id, crypto.randomUUID()] as const);
  const nodes = request.nodes.map((node) => {
    const data = { ...node.data };
    for (const key of ["values", "fieldState"]) {
      if (!(key in data)) continue;
      let value = data[key];
      for (const [id, token] of tokens) value = remapNodeReferences(value, id, token);
      for (const [id, token] of tokens) value = remapNodeReferences(value, token, request.idMap[id]);
      data[key] = value;
    }
    return { ...node, data };
  });
  const titles = new Set(current.clusters.map(({ title }) => title.toLocaleLowerCase()));
  const clusters = request.targetClusterId ? [] : request.copiedClusters.map((cluster) => {
    let title = cluster.title;
    let suffix = 2;
    while (titles.has(title.toLocaleLowerCase())) title = `${cluster.title} ${suffix++}`;
    titles.add(title.toLocaleLowerCase());
    return { ...cluster, id: crypto.randomUUID(), title, memberNodeIds: cluster.memberNodeIds.map((id) => request.idMap[id]) };
  });
  const result = insertNodesInDocument({ ...current, clusters: [...current.clusters, ...clusters] }, { ...request, nodes });
  if (!result.ok) return result;
  const pastedIds = new Set(nodes.map(({ id }) => id));
  return { ok: true, document: { ...result.document, nodes: result.document.nodes.map((node) => ({ ...node, selected: pastedIds.has(node.id) })) } };
}

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
): RenameDocumentResult {
  const source = current.nodes.find((node) => node.id === oldId);
  if (!source) throw new Error(`Node ${oldId} does not exist.`);
  if (oldId === newId && source.data?.displayName === newId) {
    return { document: current, dissolvedClusters: [], oldId, newId, changed: false };
  }
  if (oldId !== newId && current.nodes.some((node) => node.id === newId)) throw new Error(`Node ${newId} already exists.`);

  const candidate = cloneDocument(current);
  candidate.nodes = candidate.nodes.map((node) => {
    if (node.id !== oldId) {
      const data = { ...node.data };
      if (Object.prototype.hasOwnProperty.call(data, "values")) data.values = remapNodeReferences(data.values, oldId, newId);
      if (Object.prototype.hasOwnProperty.call(data, "fieldState")) data.fieldState = remapNodeReferences(data.fieldState, oldId, newId);
      return { ...node, data };
    }
    const data: Record<string, unknown> = { ...node.data, displayName: newId };
    if (Object.prototype.hasOwnProperty.call(data, "values")) data.values = remapNodeReferences(data.values, oldId, newId);
    if (Object.prototype.hasOwnProperty.call(data, "fieldState")) data.fieldState = remapNodeReferences(data.fieldState, oldId, newId);
    return { ...node, id: newId, data };
  });
  candidate.edges = candidate.edges.map((edge) => ({
      ...edge,
      source: edge.source === oldId ? newId : edge.source,
      target: edge.target === oldId ? newId : edge.target,
  }));
  candidate.clusters = candidate.clusters.map((cluster) => ({
      ...cluster,
      memberNodeIds: cluster.memberNodeIds.map((id) => id === oldId ? newId : id),
  }));

  const before = validateClusters(current.nodes, current.edges, current.clusters).violations;
  const after = validateClusters(candidate.nodes, candidate.edges, candidate.clusters).violations;
  const normalizeId = (id: string) => id === newId ? oldId : id;
  const fingerprint = (item: (typeof before)[number], normalize = false) => JSON.stringify({
    code: item.code,
    clusterId: item.clusterId,
    nodeIds: [...item.nodeIds].map((id) => normalize ? normalizeId(id) : id).sort(),
    edgeIds: [...item.edgeIds].sort(),
  });
  const prior = new Set(before.map((item) => fingerprint(item)));
  const introduced = after.filter((item) => !prior.has(fingerprint(item, true)));
  if (introduced.length > 0) throw new Error(introduced[0].message);

  return { document: candidate, dissolvedClusters: [], oldId, newId, changed: true };
}
