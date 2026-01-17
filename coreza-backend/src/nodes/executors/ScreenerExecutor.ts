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
import { getScreenerService } from "../../services/screeners";
import {
  normalizeOutput,
  createSuccessOutput,
  createErrorOutput,
  toNodeResult,
} from "../../utils/normalizeOutput";

export class ScreenerExecutor implements INodeExecutor {
  readonly category = "Screener";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const startTime = Date.now();
    try {
      const operation = node.values?.operation;
      const screener = node.subCategory ?? node.name ?? "";
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

      const screenerService = getScreenerService(screener.toLowerCase());
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
        const errOutput = createErrorOutput(
          result.error || `${screener} ${operation} operation failed`,
          {
            nodeId: node.id,
            nodeName: screener,
            category: this.category,
            startTime,
          }
        );
        return toNodeResult(errOutput);
      }

      console.log(`📊 [SCREENER] ${screener} screener completed successfully`);
      const successOutput = createSuccessOutput(result.data, {
        nodeId: node.id,
        nodeName: screener,
        category: this.category,
        startTime,
      });
      return toNodeResult(successOutput);
    } catch (error) {
      console.error("[SCREENER] Execution error:", error);
      const errOutput = createErrorOutput(
        error instanceof Error ? error : String(error),
        {
          nodeId: node.id,
          nodeName: node.name,
          category: this.category,
          startTime,
        }
      );
      return toNodeResult(errOutput);
    }
  }
}
