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

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";

export class UtilityExecutor implements INodeExecutor {
  readonly category = "Utility";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const nodeName = node.name;

      switch (nodeName) {
        case "Scheduler":
        case "trigger":
          return this.executeSchedulerNode(node, input, context);
        case "Visualize":
          return this.executeVisualizeNode(node, input, context);
        case "webhook":
          return this.executeWebhookNode(node, input, context);
        case "httprequest":
          return this.executeHttpNode(node, input, context);
        default:
          return {
            success: false,
            error: `Unsupported utility node type: ${nodeName}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Utility execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private async executeSchedulerNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    // Scheduler nodes typically just pass through data since they're triggered externally
    return {
      success: true,
      data: {
        ...input,
        triggered_at: new Date().toISOString(),
        node_id: node.id,
      },
    };
  }

  private async executeVisualizeNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    console.log("📊 Visualize node processing data:", resolvedParams);

    return {
      success: true,
      data: {
        visualization: {
          type: resolvedParams.chartType || "line",
          data: resolvedParams.data || input,
          config: resolvedParams.config || {},
          timestamp: new Date().toISOString(),
        },
      },
    };
  }

  private async executeWebhookNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    // Webhook nodes typically receive data, so we just process and return it
    return {
      success: true,
      data: {
        ...input,
        webhook_received_at: new Date().toISOString(),
        node_id: node.id,
      },
    };
  }

  private async executeHttpNode(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const resolvedParams = context?.resolveNodeParameters
      ? context.resolveNodeParameters(node, input)
      : { ...node.values, ...input };

    console.log("🌐 HTTP request node execution:", resolvedParams);

    // This would typically make an HTTP request using the HTTP service
    // For now, returning a placeholder response
    return {
      success: true,
      data: {
        request: resolvedParams,
        response: {
          status: 200,
          data: "HTTP request executed",
          timestamp: new Date().toISOString(),
        },
      },
    };
  }
}
