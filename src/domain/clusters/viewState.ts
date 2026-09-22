import type { NodeCluster } from "./types";

export type ClusterViewState = Readonly<Record<string, boolean>>;

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
): ClusterViewState => Object.fromEntries(
  clusters.map(({ id }) => [id, state[id] ?? false]),
);
