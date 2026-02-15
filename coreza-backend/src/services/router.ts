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

/**
 * Node Router - Intelligent Workflow Edge Selection
 *
 * Manages routing logic for workflow execution, handling conditional branches,
 * loops, and data flow based on node execution results.
 *
 * @module NodeRouter
 */

import { WorkflowEdge, WorkflowNode } from "../nodes/types";

/**
 * Branch-aware router that selects outgoing edges based on node results and sourceHandle
 *
 * Supports:
 * - Conditional routing (If/Switch nodes)
 * - Loop body and completion edges
 * - Data flow routing
 * - Multi-path execution
 */
export class NodeRouter {
  public silent = false;
  /**
   * Creates a new NodeRouter instance
   * @param edges - Array of all workflow edges
   */
  constructor(private edges: WorkflowEdge[]) {
    console.log(`[NodeRouter] Initialized with ${edges.length} edges`);
  }

  /**
   * Normalizes node execution results into a list of allowed edge handles
   * Handles boolean, string, and object-based results
   *
   * @param result - Node execution result
   * @returns Array of handle names that should be followed
   * @private
   */
  private decideHandles(result: any): string[] {
    // Boolean result: true/false branch
    if (typeof result === "boolean") {
      const handles = [result ? "true" : "false"];
      if (!this.silent) {
        console.log(
          `[NodeRouter] Boolean result: ${result} -> handles: ${handles}`
        );
      }
      return handles;
    }

    // String result: direct handle name
    if (typeof result === "string") {
      if (!this.silent) {
        console.log(`[NodeRouter] String result: ${result}`);
      }
      return [result];
    }

    // Object result: map of handle -> boolean
    if (
      result &&
      typeof result === "object" &&
      result &&
      typeof result === "object" &&
      ("true" in result || "false" in result)
    ) {
      const handles = Object.entries(result)
        .filter(([, v]) => !!v)
        .map(([k]) => k);

      if (!this.silent) {
        console.log(`[NodeRouter] Object result -> truthy handles: ${handles}`);
      }
      return handles;
    }

    // Default path for unhandled results
    if (!this.silent) {
      console.log("[NodeRouter] Using default handle");
    }
    return ["default", ""];
  }

  /**
   * Selects outgoing edges based on node execution result
   * Handles special routing for If/Switch nodes and passes through for data nodes
   *
   * @param nodeId - ID of the source node
   * @param result - Execution result from the node
   * @returns Array of edges to follow
   */
  select(node: WorkflowNode, result: any) {
    const outgoingEdges = this.edges.filter((e) => e.source === node.id);
    if (!this.silent) {
      console.log(
        `[NodeRouter] Selecting edges from ${node.name}, found ${outgoingEdges.length} outgoing edges`
      );
    }

    // Special handling for conditional nodes
    if (node.name === "If" || node.name === "Switch") {
      const chosen = this.decideHandles(result.data);
      const allow = new Set(chosen);

      const selectedEdges = outgoingEdges.filter((e) => {
        const h = e.sourceHandle ?? "";
        return allow.has(h);
      });

      if (!this.silent) {
        console.log(
          `[NodeRouter] Conditional node ${node.name} -> selected ${selectedEdges.length} edges`
        );
      }
      return selectedEdges;
    }

    // For data nodes (Alpaca, indicators, etc.), return ALL outgoing edges
    if (!this.silent) {
      console.log(
        `[NodeRouter] Data node ${node.name} -> returning all ${outgoingEdges.length} edges`
      );
    }
    return outgoingEdges;
  }

  /**
   * Returns edges that represent the loop body (iterations)
   * These edges have no sourceHandle or sourceHandle === 'loop'
   *
   * @param loopId - ID of the loop node
   * @returns Array of loop body edges
   */
  loopBodyEdges(loopId: string) {
    const bodyEdges = this.edges.filter(
      (e) =>
        e.source === loopId && (!e.sourceHandle || e.sourceHandle === "loop")
    );
    if (!this.silent) {
      console.log(`[NodeRouter] Loop ${loopId} body edges: ${bodyEdges.length}`);
    }
    return bodyEdges;
  }

  /**
   * Returns edges that represent loop completion
   * These edges have sourceHandle === 'done'
   *
   * @param loopId - ID of the loop node
   * @returns Array of done edges
   */
  doneEdges(loopId: string) {
    const completionEdges = this.edges.filter(
      (e) => e.source === loopId && e.sourceHandle === "done"
    );
    if (!this.silent) {
      console.log(
        `[NodeRouter] Loop ${loopId} done edges: ${completionEdges.length}`
      );
    }
    return completionEdges;
  }

  /**
   * Gets all outgoing edges from a specific node
   *
   * @param nodeId - ID of the source node
   * @returns Array of all outgoing edges
   */
  getOutgoingEdges(nodeId: string) {
    const edges = this.edges.filter((e) => e.source === nodeId);
    if (!this.silent) {
      console.log(
        `[NodeRouter] Node ${nodeId} has ${edges.length} outgoing edges`
      );
    }
    return edges;
  }
}
