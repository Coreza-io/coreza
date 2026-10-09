/** Portable hierarchy contract. Coordinates and node identity never belong here. */
export const MAX_CLUSTER_DEPTH = 2;
export const CLUSTER_FORMAT_VERSION = 2;
export interface HierarchyCluster {
  id: string;
  memberNodeIds: readonly string[];
  parentClusterId?: string;
}
export type HierarchyViolationCode =
  | "duplicate-cluster-id"
  | "duplicate-member"
  | "overlapping-membership"
  | "missing-member"
  | "invalid-parent"
  | "missing-parent"
  | "self-parent"
  | "cluster-cycle"
  | "cluster-depth";
export interface HierarchyDiagnostic {
  code: HierarchyViolationCode;
  clusterId: string;
  nodeIds: string[];
  message: string;
}

/** Cache by metadata identity and node inventory, never by positions. */
const cache = new WeakMap<
  readonly HierarchyCluster[],
  Map<string, ReturnType<typeof buildHierarchy>>
>();
// Reuse indexes across title/note edits and normalization clones. Bound retention
// because effective sets cost the sum of subtree sizes.
const structuralCache = new Map<string, ReturnType<typeof buildHierarchy>>();
export function resolveClusterHierarchy<T extends HierarchyCluster>(
  clusters: readonly T[],
  nodeIds?: Iterable<string>,
) {
  const inventory = nodeIds ? [...nodeIds].sort() : undefined;
  const key = inventory ? JSON.stringify(inventory) : "";
  let entries = cache.get(clusters);
  if (!entries) {
    entries = new Map();
    cache.set(clusters, entries);
  }
  let result = entries.get(key);
  if (!result) {
    const relationships = [...clusters]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((c) => ({
        id: c.id,
        parentClusterId: c.parentClusterId,
        memberNodeIds: [...c.memberNodeIds],
      }));
    const signature = JSON.stringify([relationships, inventory]);
    result = structuralCache.get(signature);
    if (!result) {
      result = buildHierarchy(relationships, inventory);
      structuralCache.set(signature, result);
      if (structuralCache.size > 64)
        structuralCache.delete(structuralCache.keys().next().value!);
    }
    entries.set(key, result);
  }
  return result;
}
function buildHierarchy(
  clusters: readonly HierarchyCluster[],
  inventory?: string[],
) {
  const clusterById = new Map(clusters.map((c) => [c.id, c]));
  const children = new Map(clusters.map((c) => [c.id, [] as string[]]));
  const directOwner = new Map<string, string>();
  const ancestors = new Map<string, string[]>();
  const descendants = new Map<string, string[]>();
  const effectiveMembers = new Map<string, string[]>();
  const diagnostics: HierarchyDiagnostic[] = [];
  const nodeIds = inventory && new Set(inventory);
  const report = (
    code: HierarchyViolationCode,
    clusterId: string,
    message: string,
    ids: string[] = [],
  ) => diagnostics.push({ code, clusterId, message, nodeIds: ids });
  const seen = new Set<string>();
  for (const c of clusters) {
    if (seen.has(c.id))
      report(
        "duplicate-cluster-id",
        c.id,
        "Cluster identifiers must be unique.",
      );
    seen.add(c.id);
    if (c.parentClusterId !== undefined) {
      if (typeof c.parentClusterId !== "string" || !c.parentClusterId.trim())
        report(
          "invalid-parent",
          c.id,
          "Cluster parent must be a nonempty identifier.",
        );
      else if (c.parentClusterId === c.id)
        report("self-parent", c.id, "A cluster cannot contain itself.");
      else if (!clusterById.has(c.parentClusterId))
        report("missing-parent", c.id, "Cluster parent does not exist.");
      else children.get(c.parentClusterId)!.push(c.id);
    }
    const members = new Set<string>();
    for (const id of c.memberNodeIds) {
      if (members.has(id))
        report(
          "duplicate-member",
          c.id,
          "A direct member cannot be repeated.",
          [id],
        );
      members.add(id);
      if (nodeIds && !nodeIds.has(id))
        report("missing-member", c.id, "Cluster member does not exist.", [id]);
      const owner = directOwner.get(id);
      if (owner && owner !== c.id) {
        report(
          "overlapping-membership",
          c.id,
          "A node can have only one direct owner.",
          [id],
        );
        report(
          "overlapping-membership",
          owner,
          "A node can have only one direct owner.",
          [id],
        );
      } else directOwner.set(id, c.id);
    }
  }
  for (const ids of children.values()) ids.sort();
  for (const c of [...clusters].sort((a, b) => a.id.localeCompare(b.id))) {
    const path: string[] = [];
    const visited = new Set([c.id]);
    let parent = c.parentClusterId;
    while (parent && clusterById.has(parent)) {
      if (visited.has(parent)) {
        for (const id of visited)
          report("cluster-cycle", id, "Cluster parent links contain a cycle.");
        break;
      }
      visited.add(parent);
      path.push(parent);
      parent = clusterById.get(parent)!.parentClusterId;
    }
    if (path.length + 1 > MAX_CLUSTER_DEPTH)
      for (const id of visited)
        report("cluster-depth", id, "Only two cluster levels are supported.");
    ancestors.set(c.id, path.reverse());
  }
  // Invalid relationship components are never resolved as flat scopes.
  const invalidIds = new Set(diagnostics.map((d) => d.clusterId));
  for (;;) {
    const size = invalidIds.size;
    for (const c of clusters) {
      const component = [...(ancestors.get(c.id) ?? []), c.id];
      if (component.some((id) => invalidIds.has(id)))
        component.forEach((id) => invalidIds.add(id));
    }
    if (size === invalidIds.size) break;
  }
  for (const c of clusters) {
    const nested = clusters
      .filter((x) => (ancestors.get(x.id) ?? []).includes(c.id))
      .map((x) => x.id)
      .sort();
    descendants.set(c.id, nested);
    if (
      [c.id, ...nested, ...(ancestors.get(c.id) ?? [])].some((id) =>
        invalidIds.has(id),
      )
    ) {
      invalidIds.add(c.id);
      continue;
    }
    effectiveMembers.set(c.id, [
      ...new Set(
        [c.id, ...nested].flatMap((id) => clusterById.get(id)!.memberNodeIds),
      ),
    ]);
  }
  const expandedPath = (focus: string | null | undefined): string[] =>
    focus && clusterById.has(focus) && !invalidIds.has(focus)
      ? [...(ancestors.get(focus) ?? []), focus]
      : [];
  const representative = (
    nodeId: string,
    expanded: ReadonlySet<string>,
  ): string | undefined => {
    const owner = directOwner.get(nodeId);
    return owner
      ? [...(ancestors.get(owner) ?? []), owner].find((id) => !expanded.has(id))
      : undefined;
  };
  return {
    clusterById,
    children,
    directOwner,
    ancestors,
    descendants,
    effectiveMembers,
    diagnostics,
    invalidIds,
    expandedPath,
    representative,
  };
}
