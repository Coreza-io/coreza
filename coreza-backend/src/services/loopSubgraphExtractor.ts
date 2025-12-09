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

import { WorkflowEdge, WorkflowNode } from "../nodes/types";

/**
 * Extracts the loop body subgraph (all nodes reachable from the loop handle).
 * Edges that exit via the "done" handle are intentionally excluded.
 */
export function extractLoopBodySubgraph(
  loopId: string,
  allNodes: WorkflowNode[],
  allEdges: WorkflowEdge[]
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const bodyEdges = allEdges.filter(
    (edge) => edge.source === loopId && (!edge.sourceHandle || edge.sourceHandle === "loop")
  );

  const visited = new Set<string>();
  const queue = bodyEdges.map((edge) => edge.target);
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId) || nodeId === loopId) continue;

    visited.add(nodeId);
    const node = allNodes.find((n) => n.id === nodeId);
    if (node) nodes.push(node);

    const outgoing = allEdges.filter(
      (edge) => edge.source === nodeId && edge.target !== loopId
    );

    edges.push(...outgoing);
    for (const edge of outgoing) {
      if (!visited.has(edge.target)) {
        queue.push(edge.target);
      }
    }
  }

  return { nodes, edges: [...bodyEdges, ...edges] };
}

