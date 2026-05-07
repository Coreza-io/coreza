/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
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
  /**
   * Creates a new NodeRouter instance
   * @param edges - Array of all workflow edges
   */
  constructor(private edges: WorkflowEdge[]) {}

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
      return [result ? "true" : "false"];
    }

    // String result: direct handle name
    if (typeof result === "string") {
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

      return handles;
    }

    // Default path for unhandled results
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

    // Special handling for conditional nodes
    if (node.name === "If" || node.name === "Switch") {
      const chosen = this.decideHandles(result.data);
      const allow = new Set(chosen);

      const selectedEdges = outgoingEdges.filter((e) => {
        const h = e.sourceHandle ?? "";
        return allow.has(h);
      });

      return selectedEdges;
    }

    // For data nodes (Alpaca, indicators, etc.), return ALL outgoing edges
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
    return this.edges.filter(
      (e) =>
        e.source === loopId && (!e.sourceHandle || e.sourceHandle === "loop")
    );
  }

  /**
   * Returns edges that represent loop completion
   * These edges have sourceHandle === 'done'
   *
   * @param loopId - ID of the loop node
   * @returns Array of done edges
   */
  doneEdges(loopId: string) {
    return this.edges.filter(
      (e) => e.source === loopId && e.sourceHandle === "done"
    );
  }

  /**
   * Gets all outgoing edges from a specific node
   *
   * @param nodeId - ID of the source node
   * @returns Array of all outgoing edges
   */
  getOutgoingEdges(nodeId: string) {
    return this.edges.filter((e) => e.source === nodeId);
  }
}
