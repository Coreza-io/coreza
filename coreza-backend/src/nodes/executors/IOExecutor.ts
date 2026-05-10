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
import {
  normalizeOutput,
  createSuccessOutput,
  createErrorOutput,
  toNodeResult,
} from "../../utils/normalizeOutput";

export class IOExecutor implements INodeExecutor {
  readonly category = "IO";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    try {
      // Handle different IO node types
      const nodeName = node.name;

      switch (nodeName) {
        case "ChatInput":
          return this.executeChatInput(node, input, startTime);
        default:
          const errOutput = createErrorOutput(
            `Unsupported IO node type: ${nodeName}`,
            { nodeId: node.id, nodeName, category: this.category, startTime },
          );
          return toNodeResult(errOutput);
      }
    } catch (error) {
      const errOutput = createErrorOutput(
        error instanceof Error
          ? error
          : typeof error === "object" && error !== null
            ? ((error as any).message ?? JSON.stringify(error))
            : String(error),
        {
          nodeId: node.id,
          nodeName: node.name,
          category: this.category,
        },
      );

      return toNodeResult(errOutput);
    }
  }

  private async executeChatInput(
    node: WorkflowNode,
    input: NodeInput,
    startTime: number,
  ): Promise<NodeResult> {
    // Handle chat input logic
    const message = node.values?.message || input.message || "";

    const successOutput = createSuccessOutput(
      {
        message,
        timestamp: new Date().toISOString(),
        source: "chat_input",
      },
      {
        nodeId: node.id,
        nodeName: node.name,
        category: this.category,
        startTime,
      },
    );
    return toNodeResult(successOutput);
  }
}
