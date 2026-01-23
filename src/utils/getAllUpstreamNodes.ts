/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import type { Node, Edge } from '@xyflow/react';

export function getAllUpstreamNodes(
  currentNodeId: string,
  edges: Edge[],
  nodes: Node[],
  visited: Set<string> = new Set()
): Node[] {
  try {
    if (visited.has(currentNodeId)) return [];

    visited.add(currentNodeId);

    const incomingEdges = edges.filter(e => e.target === currentNodeId);
    let result: Node[] = [];

    for (const edge of incomingEdges) {
      const upstreamNode = nodes.find(n => n.id === edge.source);
      if (upstreamNode && !result.some(n => n.id === upstreamNode.id)) {
        result.push(upstreamNode);
        result = result.concat(
          getAllUpstreamNodes(upstreamNode.id, edges, nodes, visited)
        );
      }
    }

    return result.filter(
      (n, i, arr) => arr.findIndex(m => m.id === n.id) === i
    );
  } catch (error) {
    console.warn("getAllUpstreamNodes failed, returning empty list.", error);
    return [];
  }
}
