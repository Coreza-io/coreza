import { resolveClusterHierarchy } from "./hierarchy";
import { withUniqueInstanceAliases } from "@/utils/referenceResolution";
import type { Edge, Node } from "@xyflow/react";
import type { NodeCluster } from "./types";
import {
  normalizeClusters,
  validateClusters,
  validateClusterSelection,
} from "./validate";
import { remapNodeReferenceMap } from "@/utils/remapNodeReferences";

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
  | {
      ok: false;
      code:
        | "duplicate-node"
        | "duplicate-edge"
        | "missing-endpoint"
        | "stale-cluster"
        | "invalid-document";
      message: string;
    };

export interface InsertDocumentRequest {
  nodes: readonly Node[];
  edges?: readonly Edge[];
  targetClusterId?: string | null;
  expandedClusterId?: string | null;
  ownedNodeIds?: readonly string[];
}

const cloneDocument = (document: WorkflowDocument): WorkflowDocument => ({
  nodes: document.nodes.map((node) => ({ ...node, data: { ...node.data } })),
  edges: document.edges.map((edge) => ({ ...edge, data: { ...edge.data } })),
  clusters: document.clusters.map((cluster) => ({
    ...cluster,
    memberNodeIds: [...cluster.memberNodeIds],
  })),
});

/** Builds a complete insertion candidate without exposing a partially updated graph. */
export function insertNodesInDocument(
  current: WorkflowDocument,
  request: InsertDocumentRequest,
): InsertDocumentResult {
  const nodeIds = new Set(current.nodes.map(({ id }) => id));
  for (const node of request.nodes) {
    if (nodeIds.has(node.id))
      return {
        ok: false,
        code: "duplicate-node",
        message: `Node ${node.id} already exists.`,
      };
    nodeIds.add(node.id);
  }
  const edgeIds = new Set(current.edges.map(({ id }) => id));
  for (const edge of request.edges ?? []) {
    if (edgeIds.has(edge.id))
      return {
        ok: false,
        code: "duplicate-edge",
        message: `Connection ${edge.id} already exists.`,
      };
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return {
        ok: false,
        code: "missing-endpoint",
        message: "A generated connection references a missing node.",
      };
    }
  }
  if (
    request.targetClusterId &&
    !resolveClusterHierarchy(current.clusters)
      .expandedPath(request.expandedClusterId)
      .includes(request.targetClusterId)
  ) {
    return {
      ok: false,
      code: "stale-cluster",
      message: "The target cluster is no longer expanded.",
    };
  }
  if (
    request.targetClusterId &&
    !current.clusters.some(({ id }) => id === request.targetClusterId)
  ) {
    return {
      ok: false,
      code: "stale-cluster",
      message: "The target cluster no longer exists.",
    };
  }

  const candidate = cloneDocument(current);
  candidate.nodes.push(
    ...request.nodes.map((node) => ({ ...node, data: { ...node.data } })),
  );
  candidate.edges.push(
    ...(request.edges ?? []).map((edge) => ({
      ...edge,
      data: { ...edge.data },
    })),
  );
  if (request.targetClusterId) {
    const additions = request.ownedNodeIds ?? request.nodes.map(({ id }) => id);
    candidate.clusters = candidate.clusters.map((cluster) =>
      cluster.id === request.targetClusterId
        ? {
            ...cluster,
            memberNodeIds: [
              ...cluster.memberNodeIds,
              ...additions.filter((id) => !cluster.memberNodeIds.includes(id)),
            ],
          }
        : cluster,
    );
  }
  const validation = validateClusters(
    candidate.nodes,
    candidate.edges,
    candidate.clusters,
  );
  if (!validation.valid)
    return {
      ok: false,
      code: "invalid-document",
      message: validation.violations[0].message,
    };
  return { ok: true, document: candidate };
}

/** Applies a clipboard batch and its metadata as one validated document. */
export function pasteNodesInDocument(
  current: WorkflowDocument,
  request: InsertDocumentRequest & {
    idMap: Readonly<Record<string, string>>;
    copiedClusters: readonly NodeCluster[];
    sourceNodes?: readonly Node[];
  },
): InsertDocumentResult {
  const names = withUniqueInstanceAliases(
    request.idMap,
    request.sourceNodes ?? [],
  );
  const nodes = request.nodes.map((node) => {
    const data = { ...node.data };
    for (const key of ["values", "fieldState"]) {
      if (!(key in data)) continue;
      data[key] = remapNodeReferenceMap(data[key], names);
    }
    return { ...node, data };
  });
  const titleKey = (title: string) => title.trim().toLocaleLowerCase();
  const titles = new Set(current.clusters.map(({ title }) => titleKey(title)));
  const familyTitles = new Set([
    ...titles,
    ...request.copiedClusters.map(({ title }) => titleKey(title)),
  ]);
  const clusterIds = new Map(
    request.copiedClusters.map((c) => [c.id, crypto.randomUUID()]),
  );
  const clusters = request.copiedClusters.map((cluster) => {
    const requestedTitle = cluster.title.trim();
    const root = /^(.*) [1-9]\d*$/.exec(requestedTitle)?.[1];
    const base =
      root && familyTitles.has(titleKey(root)) ? root : requestedTitle;
    let title = requestedTitle;
    let suffix = 2;
    while (titles.has(titleKey(title))) title = `${base} ${suffix++}`;
    titles.add(titleKey(title));
    const parentClusterId =
      (cluster.parentClusterId && clusterIds.get(cluster.parentClusterId)) ||
      request.targetClusterId ||
      undefined;
    return {
      ...cluster,
      id: clusterIds.get(cluster.id)!,
      title,
      parentClusterId,
      memberNodeIds: cluster.memberNodeIds.map((id) => request.idMap[id]),
    };
  });
  const result = insertNodesInDocument(
    { ...current, clusters: [...current.clusters, ...clusters] },
    {
      ...request,
      nodes,
      ownedNodeIds: nodes
        .map((n) => n.id)
        .filter((id) => !clusters.some((c) => c.memberNodeIds.includes(id))),
    },
  );
  if (!result.ok) return result;
  const pastedIds = new Set(nodes.map(({ id }) => id));
  return {
    ok: true,
    document: {
      ...result.document,
      nodes: result.document.nodes.map((node) => ({
        ...node,
        selected: pastedIds.has(node.id),
      })),
    },
  };
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
    validateClusters(
      current.nodes,
      current.edges,
      current.clusters,
    ).violations.flatMap((item) => (item.clusterId ? [item.clusterId] : [])),
  );
  mutate(candidate);
  candidate.clusters = normalizeClusters(candidate.clusters);

  const dissolvedClusters: NodeCluster[] = [];
  for (;;) {
    const hierarchy = resolveClusterHierarchy(candidate.clusters);
    if (hierarchy.diagnostics.some((d) => !["missing-member"].includes(d.code)))
      throw new Error(hierarchy.diagnostics[0].message);
    const validation = validateClusters(
      candidate.nodes,
      candidate.edges,
      candidate.clusters,
    );
    const newlyInvalid = validation.violations.find(
      (v) => v.clusterId && !invalidBefore.has(v.clusterId),
    );
    if (!newlyInvalid) break;
    const cluster = candidate.clusters.find(
      (c) => c.id === newlyInvalid.clusterId,
    )!;
    dissolvedClusters.push(cluster);
    promoteCluster(candidate, cluster.id);
  }
  return { document: candidate, dissolvedClusters };
}

export function deleteNodesFromDocument(
  current: WorkflowDocument,
  nodeIds: ReadonlySet<string>,
): DocumentMutationResult {
  return mutateDocument(current, (candidate) => {
    candidate.nodes = candidate.nodes.filter((node) => !nodeIds.has(node.id));
    candidate.edges = candidate.edges.filter(
      (edge) => !nodeIds.has(edge.source) && !nodeIds.has(edge.target),
    );
    candidate.clusters = candidate.clusters.map((cluster) => ({
      ...cluster,
      memberNodeIds: cluster.memberNodeIds.filter((id) => !nodeIds.has(id)),
    }));
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
    return {
      document: current,
      dissolvedClusters: [],
      oldId,
      newId,
      changed: false,
    };
  }
  if (oldId !== newId && current.nodes.some((node) => node.id === newId))
    throw new Error(`Node ${newId} already exists.`);

  const names = withUniqueInstanceAliases({ [oldId]: newId }, current.nodes);
  const candidate = cloneDocument(current);
  candidate.nodes = candidate.nodes.map((node) => {
    if (node.id !== oldId) {
      const data = { ...node.data };
      if (Object.prototype.hasOwnProperty.call(data, "values"))
        data.values = remapNodeReferenceMap(data.values, names);
      if (Object.prototype.hasOwnProperty.call(data, "fieldState"))
        data.fieldState = remapNodeReferenceMap(data.fieldState, names);
      return { ...node, data };
    }
    const data: Record<string, unknown> = { ...node.data, displayName: newId };
    if (Object.prototype.hasOwnProperty.call(data, "values"))
      data.values = remapNodeReferenceMap(data.values, names);
    if (Object.prototype.hasOwnProperty.call(data, "fieldState"))
      data.fieldState = remapNodeReferenceMap(data.fieldState, names);
    return { ...node, id: newId, data };
  });
  candidate.edges = candidate.edges.map((edge) => ({
    ...edge,
    source: edge.source === oldId ? newId : edge.source,
    target: edge.target === oldId ? newId : edge.target,
  }));
  candidate.clusters = candidate.clusters.map((cluster) => ({
    ...cluster,
    memberNodeIds: cluster.memberNodeIds.map((id) =>
      id === oldId ? newId : id,
    ),
  }));

  const before = validateClusters(
    current.nodes,
    current.edges,
    current.clusters,
  ).violations;
  const after = validateClusters(
    candidate.nodes,
    candidate.edges,
    candidate.clusters,
  ).violations;
  const normalizeId = (id: string) => (id === newId ? oldId : id);
  const fingerprint = (item: (typeof before)[number], normalize = false) =>
    JSON.stringify({
      code: item.code,
      clusterId: item.clusterId,
      nodeIds: [...item.nodeIds]
        .map((id) => (normalize ? normalizeId(id) : id))
        .sort(),
      edgeIds: [...item.edgeIds].sort(),
    });
  const prior = new Set(before.map((item) => fingerprint(item)));
  const introduced = after.filter(
    (item) => !prior.has(fingerprint(item, true)),
  );
  if (introduced.length > 0) throw new Error(introduced[0].message);

  return {
    document: candidate,
    dissolvedClusters: [],
    oldId,
    newId,
    changed: true,
  };
}

/** Dissolution retains canonical nodes and promotes children/direct ownership. */
function promoteCluster(document: WorkflowDocument, id: string): void {
  const removed = document.clusters.find((c) => c.id === id);
  if (!removed) return;
  document.clusters = document.clusters
    .filter((c) => c.id !== id)
    .map((c) => ({
      ...c,
      ...(c.parentClusterId === id
        ? { parentClusterId: removed.parentClusterId }
        : {}),
      memberNodeIds:
        c.id === removed.parentClusterId
          ? [...c.memberNodeIds, ...removed.memberNodeIds]
          : c.memberNodeIds,
    }));
}
export function dissolveClusterInDocument(
  current: WorkflowDocument,
  id: string,
): DocumentMutationResult {
  const removed = current.clusters.find((c) => c.id === id);
  const result = mutateDocument(current, (candidate) =>
    promoteCluster(candidate, id),
  );
  return {
    ...result,
    dissolvedClusters: removed
      ? [removed, ...result.dissolvedClusters]
      : result.dissolvedClusters,
  };
}

/** Container selection stays atomic; ordinary nodes must share one direct owner. */
export function groupSelectionInDocument(
  current: WorkflowDocument,
  selectedNodeIds: readonly string[],
  selectedClusterIds: ReadonlySet<string>,
  candidate: NodeCluster,
): InsertDocumentResult {
  const hierarchy = resolveClusterHierarchy(
    current.clusters,
    current.nodes.map((n) => n.id),
  );
  if (hierarchy.diagnostics.length)
    return {
      ok: false,
      code: "invalid-document",
      message: hierarchy.diagnostics[0].message,
    };
  const selectedRoots = current.clusters.filter(
    (c) =>
      selectedClusterIds.has(c.id) &&
      !(hierarchy.ancestors.get(c.id) ?? []).some((id) =>
        selectedClusterIds.has(id),
      ),
  );
  if (
    selectedRoots.some(
      (c) =>
        c.parentClusterId || (hierarchy.children.get(c.id)?.length ?? 0) > 0,
    )
  )
    return {
      ok: false,
      code: "invalid-document",
      message: "Wrapping this container would exceed two cluster levels.",
    };
  const atomicLeaves = new Set(
    selectedRoots.flatMap((c) => hierarchy.effectiveMembers.get(c.id) ?? []),
  );
  const ordinary = selectedNodeIds.filter((id) => !atomicLeaves.has(id));
  const owners = new Set(ordinary.map((id) => hierarchy.directOwner.get(id)));
  let parentClusterId: string | undefined;
  if (selectedRoots.length) {
    if ([...owners].some((id) => id !== undefined))
      return {
        ok: false,
        code: "invalid-document",
        message: "Wrap root containers and unclustered nodes only.",
      };
  } else {
    if (owners.size !== 1)
      return {
        ok: false,
        code: "invalid-document",
        message: "Selected nodes must share one direct owner.",
      };
    parentClusterId = [...owners][0];
    if (
      parentClusterId &&
      hierarchy.clusterById.get(parentClusterId)?.parentClusterId
    )
      return {
        ok: false,
        code: "invalid-document",
        message: "Only two cluster levels are supported.",
      };
  }
  const leaves = [...atomicLeaves, ...ordinary];
  const selection = validateClusterSelection(
    leaves,
    current.nodes,
    current.edges,
    [],
    { ...candidate, parentClusterId: undefined },
  );
  if (!selection.valid)
    return {
      ok: false,
      code: "invalid-document",
      message: selection.violations[0].message,
    };
  const resolved = selection.resolvedMemberNodeIds ?? leaves;
  if (
    resolved.some((id) => {
      const owner = hierarchy.directOwner.get(id);
      return (
        owner !== undefined &&
        owner !== parentClusterId &&
        !selectedRoots.some((c) => c.id === owner)
      );
    })
  )
    return {
      ok: false,
      code: "invalid-document",
      message: "An attachment crosses the selected ownership boundary.",
    };
  const document = cloneDocument(current);
  const transferred = new Set(resolved.filter((id) => !atomicLeaves.has(id)));
  document.clusters = document.clusters.map((c) => ({
    ...c,
    ...(selectedRoots.some((root) => root.id === c.id)
      ? { parentClusterId: candidate.id }
      : {}),
    memberNodeIds:
      c.id === parentClusterId
        ? c.memberNodeIds.filter((id) => !transferred.has(id))
        : c.memberNodeIds,
  }));
  document.clusters.push({
    ...candidate,
    parentClusterId,
    memberNodeIds: [...transferred],
  });
  const validation = validateClusters(
    document.nodes,
    document.edges,
    document.clusters,
  );
  return validation.valid
    ? { ok: true, document }
    : {
        ok: false,
        code: "invalid-document",
        message: validation.violations[0].message,
      };
}

/** Include only intact subtrees; copied roots detach from uncopied parents. */
export function copyClusterMetadata(
  clusters: readonly NodeCluster[],
  selectedNodeIds: ReadonlySet<string>,
): NodeCluster[] {
  const hierarchy = resolveClusterHierarchy(clusters);
  const copied = clusters.filter(
    (c) =>
      (hierarchy.effectiveMembers.get(c.id)?.length ?? 0) > 0 &&
      hierarchy.effectiveMembers
        .get(c.id)!
        .every((id) => selectedNodeIds.has(id)),
  );
  const ids = new Set(copied.map((c) => c.id));
  return copied.map((c) => ({
    ...c,
    memberNodeIds: [...c.memberNodeIds],
    parentClusterId:
      c.parentClusterId && ids.has(c.parentClusterId)
        ? c.parentClusterId
        : undefined,
  }));
}
