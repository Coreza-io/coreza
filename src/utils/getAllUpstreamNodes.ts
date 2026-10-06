/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import type { Node, Edge } from "@xyflow/react";

type Id = string;

type UpstreamIndex = {
  nodeById: Map<Id, Node>;
  incomingByTarget: Map<Id, Id[]>; // targetId -> [sourceId...]
};

/**
 * Build indexes once to avoid O(E) scans + O(N) lookups on every recursion.
 * Cost: O(N + E)
 */
function buildUpstreamIndex(edges: readonly Edge[], nodes: readonly Node[]): UpstreamIndex {
  const nodeById = new Map<Id, Node>();
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (n?.id) nodeById.set(n.id, n);
  }

  const incomingByTarget = new Map<Id, Id[]>();
  for (let i = 0; i < edges.length; i += 1) {
    const e = edges[i];
    if (!e?.target || !e?.source) continue;

    let list = incomingByTarget.get(e.target);
    if (!list) {
      list = [];
      incomingByTarget.set(e.target, list);
    }
    list.push(e.source);
  }

  return { nodeById, incomingByTarget };
}

/**
 * Get all upstream (ancestor) nodes of the given node id.
 *
 * - Uses iterative DFS (no recursion depth risk)
 * - Cycle-safe
 * - O(N + E) traversal after indexing
 * - Deterministic order based on edge iteration order
 * Live editor consumers use the editor-scoped semantic graph index. This
 * standalone helper intentionally owns no module-global cache so independent
 * history views and tests cannot evict one another.
 */
export function getAllUpstreamNodes(
  currentNodeId: string,
  edges: readonly Edge[],
  nodes: readonly Node[],
): Node[] {
  try {
    if (!currentNodeId || !Array.isArray(edges) || !Array.isArray(nodes)) {
      return [];
    }

    const { nodeById, incomingByTarget } = buildUpstreamIndex(edges, nodes);

    const visited = new Set<Id>(); // visited node ids in traversal
    const result = new Map<Id, Node>(); // dedupe + stable insertion order

    // Start from the current node and walk backwards
    const stack: Id[] = [currentNodeId];

    while (stack.length > 0) {
      const targetId = stack.pop();
      if (!targetId) continue;

      if (visited.has(targetId)) continue;
      visited.add(targetId);

      const sources = incomingByTarget.get(targetId);
      if (!sources || sources.length === 0) continue;

      for (let i = 0; i < sources.length; i += 1) {
        const sourceId = sources[i];
        if (!sourceId) continue;

        const upstreamNode = nodeById.get(sourceId);
        if (upstreamNode && !result.has(sourceId)) {
          result.set(sourceId, upstreamNode);
        }

        // Continue walking upstream regardless of whether the node exists,
        // because edges can temporarily point to nodes being edited/removed.
        if (!visited.has(sourceId)) {
          stack.push(sourceId);
        }
      }
    }

    return Array.from(result.values());
  } catch (error) {
    console.warn("getAllUpstreamNodes failed, returning empty list.", error);
    return [];
  }
}
