/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { createSuccessOutput, createErrorOutput, toNodeResult } from "../../utils/normalizeOutput";

export class UtilityExecutor implements INodeExecutor {
  readonly category = "Utility";
  readonly syncCapable = true;

  execute(node: WorkflowNode, input: NodeInput, context?: any): NodeResult {
    const startTime = Date.now();
    try {
      return this.executeByNodeName(node, input, context, startTime);
    } catch (error) {
      const errOutput = createErrorOutput(
        error instanceof Error ? error : String(error),
        { nodeId: node.id, nodeName: node.name, category: this.category, startTime }
      );
      return toNodeResult(errOutput);
    }
  }

  private executeByNodeName(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
    startTime?: number,
  ): NodeResult {
    const nodeName = node.name;

    switch (nodeName) {
      case "Scheduler":
      case "trigger":
        return this.executeSchedulerNode(node, input, context, startTime);
      case "Visualize":
        return this.executeVisualizeNode(node, input, context, startTime);
      case "webhook":
        return this.executeWebhookNode(node, input, context, startTime);
      case "httprequest":
        return this.executeHttpNode(node, input, context, startTime);
      default:
        const errOutput = createErrorOutput(
          `Unsupported utility node type: ${nodeName}`,
          { nodeId: node.id, nodeName, category: this.category, startTime }
        );
        return toNodeResult(errOutput);
    }
  }

  private executeSchedulerNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
    startTime?: number
  ): NodeResult {
    // Scheduler nodes typically just pass through data since they're triggered externally
    const successOutput = createSuccessOutput({
      ...input,
      triggered_at: new Date().toISOString(),
      node_id: node.id,
    }, {
      nodeId: node.id,
      nodeName: node.name,
      category: this.category,
      startTime,
    });
    return toNodeResult(successOutput);
  }

  private executeVisualizeNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
    startTime?: number
  ): NodeResult {
    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    console.log("📊 Visualize node processing data:", resolvedParams);

    const successOutput = createSuccessOutput({
      visualization: {
        type: resolvedParams.chartType || "line",
        data: resolvedParams.data || input,
        config: resolvedParams.config || {},
        timestamp: new Date().toISOString(),
      },
    }, {
      nodeId: node.id,
      nodeName: node.name,
      category: this.category,
      startTime,
    });
    return toNodeResult(successOutput);
  }

  private executeWebhookNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
    startTime?: number
  ): NodeResult {
    // Scan classification: pure — this node only normalizes an already-received payload.
    const successOutput = createSuccessOutput({
      ...input,
      webhook_received_at: new Date().toISOString(),
      node_id: node.id,
    }, {
      nodeId: node.id,
      nodeName: node.name,
      category: this.category,
      startTime,
    });
    return toNodeResult(successOutput);
  }

  private executeHttpNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
    startTime?: number
  ): NodeResult {
    // Scan classification: pure — outbound HTTP is not implemented by this executor.
    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    console.log("🌐 HTTP request node execution:", resolvedParams);

    // This would typically make an HTTP request using the HTTP service
    // For now, returning a placeholder response
    const successOutput = createSuccessOutput({
      request: resolvedParams,
      response: {
        status: 200,
        data: "HTTP request executed",
        timestamp: new Date().toISOString(),
      },
    }, {
      nodeId: node.id,
      nodeName: node.name,
      category: this.category,
      startTime,
    });
    return toNodeResult(successOutput);
  }
}
