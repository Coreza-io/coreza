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

export class IOExecutor implements INodeExecutor {
  readonly category = "IO";

  async execute(node: WorkflowNode, input: NodeInput): Promise<NodeResult> {
    try {
      // Handle different IO node types
      const nodeName = node.name;

      switch (nodeName) {
        case "ChatInput":
          return this.executeChatInput(node, input);
        default:
          return {
            success: false,
            error: `Unsupported IO node type: ${nodeName}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `IO execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private async executeChatInput(
    node: WorkflowNode,
    input: NodeInput
  ): Promise<NodeResult> {
    // Handle chat input logic
    const message = node.values?.message || input.message || "";

    return {
      success: true,
      data: {
        message,
        timestamp: new Date().toISOString(),
        source: "chat_input",
      },
    };
  }
}
