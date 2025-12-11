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
import { IndicatorService } from "../../services/indicators";

export class IndicatorsExecutor implements INodeExecutor {
  readonly category = "Indicators";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const indicatorType = (node.name || node.node_type)?.toLowerCase();
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      console.log(
        `🔢 Executing ${indicatorType} indicator with params:`,
        resolvedParams
      );

      const result = await IndicatorService.calculate(
        indicatorType,
        resolvedParams
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error || `${indicatorType} calculation failed`,
        };
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: `Indicator execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
