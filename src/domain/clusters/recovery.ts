import type { Node, Edge } from "@xyflow/react";
import { parseNodeClusters } from "./parse";
import { validateClusters } from "./validate";
import { resolveClusterHierarchy } from "./hierarchy";

/** Recover intact relationship components while retaining exact source diagnostics. */
export function recoverClusterDocument(
  raw: unknown,
  nodes: readonly Node[],
  edges: readonly Edge[],
) {
  const parsed = parseNodeClusters(raw);
  const hierarchy = resolveClusterHierarchy(parsed.clusters);
  const invalid = new Set(
    validateClusters(nodes, edges, parsed.clusters).violations.flatMap((v) =>
      v.clusterId ? [v.clusterId] : [],
    ),
  );
  for (;;) {
    const previousSize = invalid.size;
    for (const c of parsed.clusters) {
      const related = [
        c.id,
        ...(hierarchy.ancestors.get(c.id) ?? []),
        ...(hierarchy.descendants.get(c.id) ?? []),
      ];
      if (related.some((id) => invalid.has(id)))
        related.forEach((id) => invalid.add(id));
    }
    if (previousSize === invalid.size) break;
  }
  const invalidEntries = [...parsed.invalidEntries];
  const clusters = parsed.clusters.filter((c, i) => {
    if (!invalid.has(c.id)) return true;
    const index = parsed.sourceIndexes?.[i] ?? i;
    invalidEntries.push({ index, value: Array.isArray(raw) ? raw[index] : c });
    return false;
  });
  return {
    clusters,
    invalidEntries: invalidEntries.sort((a, b) => a.index - b.index),
  };
}
