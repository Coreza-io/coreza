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
import { normalizeOutput, createSuccessOutput, createErrorOutput, toNodeResult } from "../../utils/normalizeOutput";

export class IOExecutor implements INodeExecutor {
  readonly category = "IO";

  async execute(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
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
            { nodeId: node.id, nodeName, category: this.category, startTime }
          );
          return toNodeResult(errOutput);
      }
    } catch (error) {
      const errOutput = createErrorOutput(
        error instanceof Error ? error : String(error),
        { nodeId: node.id, nodeName: node.name, category: this.category, startTime }
      );
      return toNodeResult(errOutput);
    }
  }

  private async executeChatInput(
    node: WorkflowNode,
    input: NodeInput,
    startTime: number
  ): Promise<NodeResult> {
    // Handle chat input logic
    const message = node.values?.message || input.message || "";

    const successOutput = createSuccessOutput({
      message,
      timestamp: new Date().toISOString(),
      source: "chat_input",
    }, {
      nodeId: node.id,
      nodeName: node.name,
      category: this.category,
      startTime,
    });
    return toNodeResult(successOutput);
  }
}
