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
import { CommunicationService } from "../../services/communications";
import axios from "axios";
import { resolveReferences } from "../../utils/resolveReferences";
import CredentialManager from "../../utils/credentialManager";

export class CommunicationExecutor implements INodeExecutor {
  readonly category = "Communication";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const nodeName = node.name;
      const operation = node.values?.operation || "send";
      const credential_id = node.values?.credential_id;
      const user_id = context.user_id;

      // Resolve and merge node parameters with input data
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const combinedInput = {
        ...input,
        ...resolvedParams,
        user_id,
        credential_id,
      };

      let result;
      switch (nodeName) {
        case "Gmail":
          result = await CommunicationService.execute(
            "gmail",
            operation,
            combinedInput
          );
          break;
        case "WhatsApp":
          result = await CommunicationService.execute(
            "whatsapp",
            operation,
            combinedInput
          );
          break;
        default:
          return {
            success: false,
            error: `Unsupported communication node type: ${nodeName}`,
          };
      }

      if (!result.success) {
        return {
          success: false,
          error: result.error || `${nodeName} ${operation} operation failed`,
        };
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      return {
        success: false,
        error: `Communication execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
