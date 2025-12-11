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
import { RiskEngineService } from "../../services/risk";

export class RiskExecutor implements INodeExecutor {
  readonly category = "Risk Management";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      console.log(
        `⚖️ Executing ${node.name} node with params:`,
        resolvedParams
      );
      const result = RiskEngineService.evaluate(resolvedParams);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, data: result.data };
    } catch (error) {
      return {
        success: false,
        error: `Risk engine execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
