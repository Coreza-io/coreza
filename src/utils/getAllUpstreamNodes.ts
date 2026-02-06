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

function getNodeById(nodes: Node[], id: string): Node | undefined {
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i]?.id === id) {
      return nodes[i];
    }
  }

  return undefined;
}

export function getAllUpstreamNodes(
  currentNodeId: string,
  edges: Edge[],
  nodes: Node[],
  visited: Set<string> = new Set()
): Node[] {
  try {
    if (!currentNodeId || !Array.isArray(edges) || !Array.isArray(nodes)) {
      return [];
    }

    if (visited.has(currentNodeId)) {
      return [];
    }

    visited.add(currentNodeId);

    const uniqueNodes = new Map<string, Node>();

    for (let i = 0; i < edges.length; i += 1) {
      const edge = edges[i];
      if (!edge || edge.target !== currentNodeId) {
        continue;
      }

      const upstreamNode = getNodeById(nodes, edge.source);
      if (!upstreamNode) {
        continue;
      }

      uniqueNodes.set(upstreamNode.id, upstreamNode);

      const nestedNodes = getAllUpstreamNodes(upstreamNode.id, edges, nodes, visited);
      for (let j = 0; j < nestedNodes.length; j += 1) {
        const nestedNode = nestedNodes[j];
        if (nestedNode?.id) {
          uniqueNodes.set(nestedNode.id, nestedNode);
        }
      }
    }

    return Array.from(uniqueNodes.values());
  } catch (error) {
    console.warn('getAllUpstreamNodes failed, returning empty list.', error);
    return [];
  }
}
