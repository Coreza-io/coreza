import { resolveClusterHierarchy } from './hierarchy';
import type { Node } from "@xyflow/react";
import type { NodeCluster } from "./types";

export const resolveCanonicalSelection = (
  nodes: readonly Node[],
  clusters: readonly NodeCluster[],
  selectedClusterIds: ReadonlySet<string>,
  hiddenRuntimeHostIds: ReadonlySet<string> = new Set(),
  actionableClusterIds: ReadonlySet<string> = selectedClusterIds,
): string[] => {
  const canonicalNodeIds = new Set(nodes.map(({ id }) => id));
  const selectedNodeIds = nodes
    .filter(({ id, selected }) => selected && !hiddenRuntimeHostIds.has(id))
    .map(({ id }) => id);
  const hierarchy = resolveClusterHierarchy(clusters);
  const selectedClusterMemberIds = clusters
    .filter(({ id }) => selectedClusterIds.has(id) && actionableClusterIds.has(id))
    .flatMap(({ id }) => hierarchy.effectiveMembers.get(id) ?? []);

  return [...new Set([...selectedNodeIds, ...selectedClusterMemberIds])]
    .filter((id) => canonicalNodeIds.has(id));
};
