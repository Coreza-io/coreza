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
 * 
 * @param loopId - The ID of the loop node
 * @param allNodes - All nodes in the workflow
 * @param allEdges - All edges in the workflow
 * @returns The subgraph containing only nodes and edges within the loop body
 */
export function extractLoopBodySubgraph(
  loopId: string,
  allNodes: WorkflowNode[],
  allEdges: WorkflowEdge[]
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  // Get edges from the "loop" handle (not the "done" handle)
  const bodyEdges = allEdges.filter(
    (edge) => edge.source === loopId && (!edge.sourceHandle || edge.sourceHandle === "loop")
  );

  const visited = new Set<string>();
  const queue = bodyEdges.map((edge) => edge.target);
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  // BFS to find all reachable nodes from the loop body
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId) || nodeId === loopId) continue;

    visited.add(nodeId);
    const node = allNodes.find((n) => n.id === nodeId);
    if (node) nodes.push(node);

    // Get outgoing edges (except those going back to the loop node)
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

  // Include the initial body edges connecting loop to first nodes
  return { nodes, edges: [...bodyEdges, ...edges] };
}
