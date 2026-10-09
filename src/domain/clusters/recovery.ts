import type { Node, Edge } from "@xyflow/react";
import { parseNodeClusters } from "./parse";
import { validateClusters } from "./validate";

/** Recover intact relationship components while retaining exact source diagnostics. */
export function recoverClusterDocument(
  raw: unknown,
  nodes: readonly Node[],
  edges: readonly Edge[],
) {
  const parsed = parseNodeClusters(raw);
  // Even an entry with an invalid title/note/parent can make trustworthy claims
  // about its ID, parent, or direct members. Keep those claims in the quarantine
  // graph so parsing cannot detach a damaged child or choose a conflicting owner.
  const entries = Array.isArray(raw) ? raw : [];
  const claims = entries.map((value: unknown) => {
    const entry = typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
    return {
      id: typeof entry.id === "string" ? entry.id : undefined,
      parent: typeof entry.parentClusterId === "string" ? entry.parentClusterId : undefined,
      members: Array.isArray(entry.memberNodeIds)
        ? entry.memberNodeIds.filter((id): id is string => typeof id === "string") : [],
    };
  });
  const related = claims.map(() => new Set<number>());
  const byId = new Map<string, number[]>();
  const byMember = new Map<string, number[]>();
  claims.forEach((claim, index) => {
    if (claim.id !== undefined) byId.set(claim.id, [...(byId.get(claim.id) ?? []), index]);
    for (const member of new Set(claim.members))
      byMember.set(member, [...(byMember.get(member) ?? []), index]);
  });
  const link = (a: number, b: number) => {
    related[a].add(b);
    related[b].add(a);
  };
  for (const indexes of [...byId.values(), ...byMember.values()])
    for (const index of indexes.slice(1)) link(indexes[0], index);
  claims.forEach((claim, index) => {
    if (claim.parent !== undefined)
      for (const parent of byId.get(claim.parent) ?? []) link(index, parent);
  });
  const invalid = new Set(parsed.invalidIndexes);
  for (const violation of validateClusters(nodes, edges, parsed.clusters).violations) {
    if (violation.clusterId !== undefined)
      for (const index of byId.get(violation.clusterId) ?? []) invalid.add(index);
  }
  const pending = [...invalid];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    for (const index of related[pending[cursor]] ?? []) {
      if (invalid.has(index)) continue;
      invalid.add(index);
      pending.push(index);
    }
  }
  const clusters = parsed.clusters.filter((_c, index) =>
    !invalid.has(parsed.sourceIndexes?.[index] ?? index));
  const invalidEntries = Array.isArray(raw)
    ? [...invalid].sort((a, b) => a - b).map(index => ({index, value: raw[index]}))
    : parsed.invalidEntries;
  return {
    clusters,
    invalidEntries: invalidEntries.sort((a, b) => a.index - b.index),
  };
}
