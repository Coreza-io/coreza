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
import { getScreenerService } from "../../services/screeners/registry";

export class ScreenerExecutor implements INodeExecutor {
  readonly category = "Screener";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const operation = node.values?.operation;
      const screener = node.subCategory ?? node.name;
      const credential_id = node.values?.credential_id;

      // Credential is optional for manual screeners
      if (!credential_id && screener !== "YahooFinance") {
        return {
          success: false,
          error: `${screener || "Screener"} credential_id is required`,
        };
      }

      // Resolve and merge node parameters with input data
      console.log(
        `📊 [SCREENER] Starting parameter resolution for node ${node.id}`
      );
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };
      console.log(
        `📊 [SCREENER] Parameter resolution completed for node ${node.id}`,
        resolvedParams
      );

      const screenerService = getScreenerService(screener);
      if (!screenerService) {
        return {
          success: false,
          error: `Unsupported screener: ${screener}`,
        };
      }

      console.log(
        `📊 [SCREENER] Executing ${screener} screener with operation: ${operation}`
      );
      const result = await screenerService.execute({
        user_id: context?.userId,
        credential_id,
        operation,
        ...resolvedParams,
        input,
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error || `${screener} ${operation} operation failed`,
        };
      }

      console.log(`📊 [SCREENER] ${screener} screener completed successfully`);
      return {
        data: result.data,
      };
    } catch (error) {
      console.error("[SCREENER] Execution error:", error);
      return {
        success: false,
        error: `Screener execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
