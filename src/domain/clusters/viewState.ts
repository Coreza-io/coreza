import { resolveClusterHierarchy } from "./hierarchy";
import type { NodeCluster } from "./types";

export type ClusterViewState = Readonly<Record<string, boolean>>;
export type FocusedClusterId = string | null;

export const hasValidClusterMembers = (
  cluster: NodeCluster,
  canonicalNodeIds?: ReadonlySet<string>,
): boolean =>
  canonicalNodeIds === undefined
    ? cluster.memberNodeIds.length > 0
    : cluster.memberNodeIds.some((id) => canonicalNodeIds.has(id));

export const openFocusedCluster = (
  focusedClusterId: FocusedClusterId,
  clusterId: string,
  clusters: readonly NodeCluster[],
  canonicalNodeIds?: ReadonlySet<string>,
): FocusedClusterId =>
  clusters.some(
    (cluster) =>
      cluster.id === clusterId &&
      (
        resolveClusterHierarchy(clusters).effectiveMembers.get(cluster.id) ?? []
      ).some((id) => !canonicalNodeIds || canonicalNodeIds.has(id)),
  )
    ? clusterId
    : focusedClusterId;

export const closeFocusedCluster = (
  focusedClusterId?: FocusedClusterId,
  clusters: readonly NodeCluster[] = [],
): FocusedClusterId =>
  clusters.find((c) => c.id === focusedClusterId)?.parentClusterId ?? null;

export const reconcileFocusedCluster = (
  focusedClusterId: FocusedClusterId,
  clusters: readonly NodeCluster[],
  canonicalNodeIds?: ReadonlySet<string>,
): FocusedClusterId =>
  focusedClusterId !== null &&
  clusters.some(
    (cluster) =>
      cluster.id === focusedClusterId &&
      (
        resolveClusterHierarchy(clusters).effectiveMembers.get(cluster.id) ?? []
      ).some((id) => !canonicalNodeIds || canonicalNodeIds.has(id)),
  )
    ? focusedClusterId
    : null;

export const focusedClusterToViewState = (
  focusedClusterId: FocusedClusterId,
  clusters: readonly NodeCluster[] = [],
): ClusterViewState =>
  clusters.length
    ? Object.fromEntries(
        resolveClusterHierarchy(clusters)
          .expandedPath(focusedClusterId)
          .map((id) => [id, true]),
      )
    : focusedClusterId === null
      ? {}
      : { [focusedClusterId]: true };

export const isClusterExpanded = (
  state: ClusterViewState,
  clusterId: string,
): boolean => state[clusterId] ?? false;

export const setClusterExpanded = (
  state: ClusterViewState,
  clusterId: string,
  expanded: boolean,
): ClusterViewState => ({ ...state, [clusterId]: expanded });

export const reconcileClusterViewState = (
  state: ClusterViewState,
  clusters: readonly NodeCluster[],
): ClusterViewState =>
  Object.fromEntries(clusters.map(({ id }) => [id, state[id] ?? false]));
