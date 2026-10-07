import type { Edge, Node } from "@xyflow/react";
import type { ClusterProjection } from "./projection";

/**
 * Structural sharing for cluster projections.
 *
 * `projectClusterGraph` always recomputes geometry and visibility; this layer
 * only returns previously committed references where the freshly computed
 * output is equivalent, so React Flow and memoized consumers skip unchanged
 * nodes/edges during drags. It never mutates either input.
 */

const MAX_DEPTH = 3;

const equivalent = (a: unknown, b: unknown, depth: number): boolean => {
  if (Object.is(a, b)) return true;
  if (depth <= 0 || typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!equivalent(a[index], b[index], depth - 1)) return false;
    }
    return true;
  }
  // Only plain records are compared structurally; class instances (Map, Date…) need identity.
  if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!equivalent((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], depth - 1)) return false;
  }
  return true;
};

const reuseItems = <T extends { id: string }>(previous: readonly T[], next: T[]): T[] => {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  let allReused = previous.length === next.length;
  const result = next.map((item, index) => {
    const prior = previousById.get(item.id);
    const reused = prior !== undefined && equivalent(prior, item, MAX_DEPTH) ? prior : item;
    if (reused !== previous[index]) allReused = false;
    return reused;
  });
  return allReused ? (previous as T[]) : result;
};

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
};

const sameMap = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean => {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
};

export function reconcileClusterProjection(
  previous: ClusterProjection | null,
  next: ClusterProjection,
): ClusterProjection {
  if (!previous) return next;
  const nodes = reuseItems<Node>(previous.nodes, next.nodes);
  const edges = reuseItems<Edge>(previous.edges, next.edges);
  const displayNodeToCluster = sameMap(previous.displayNodeToCluster, next.displayNodeToCluster)
    ? previous.displayNodeToCluster : next.displayNodeToCluster;
  const displayEdgeToCanonicalEdge = sameMap(previous.displayEdgeToCanonicalEdge, next.displayEdgeToCanonicalEdge)
    ? previous.displayEdgeToCanonicalEdge : next.displayEdgeToCanonicalEdge;
  const hiddenRuntimeHostIds = sameSet(previous.hiddenRuntimeHostIds, next.hiddenRuntimeHostIds)
    ? previous.hiddenRuntimeHostIds : next.hiddenRuntimeHostIds;
  const visibleNodeIds = sameSet(previous.visibleNodeIds, next.visibleNodeIds)
    ? previous.visibleNodeIds : next.visibleNodeIds;
  if (
    nodes === previous.nodes && edges === previous.edges
    && displayNodeToCluster === previous.displayNodeToCluster
    && displayEdgeToCanonicalEdge === previous.displayEdgeToCanonicalEdge
    && hiddenRuntimeHostIds === previous.hiddenRuntimeHostIds
    && visibleNodeIds === previous.visibleNodeIds
  ) return previous;
  return { nodes, edges, displayNodeToCluster, displayEdgeToCanonicalEdge, hiddenRuntimeHostIds, visibleNodeIds };
}
