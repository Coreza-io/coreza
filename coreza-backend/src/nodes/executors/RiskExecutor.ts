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
import { createSuccessOutput, createErrorOutput, toNodeResult, NormalizeContext } from "../../utils/normalizeOutput";

export class RiskExecutor implements INodeExecutor {
  readonly category = "Risk Management";

  executeSync(node: WorkflowNode, input: NodeInput, context?: any): NodeResult {
    const startTime = Date.now();
    return this.executeInternal(node, input, context, startTime);
  }

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const startTime = Date.now();
    return this.executeInternal(node, input, context, startTime);
  }

  private executeInternal(
    node: WorkflowNode,
    input: NodeInput,
    context: any,
    startTime: number,
  ): NodeResult {
    const normalizeCtx: NormalizeContext = {
      nodeId: node.id,
      nodeName: node.name,
      category: this.category,
      startTime,
    };

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
        const errOutput = createErrorOutput(result.error || "Risk evaluation failed", normalizeCtx);
        return toNodeResult(errOutput);
      }
      const successOutput = createSuccessOutput(result.data, normalizeCtx);
      return toNodeResult(successOutput);
    } catch (error) {
      const errOutput = createErrorOutput(
        `Risk engine execution failed: ${error instanceof Error ? error.message : String(error)}`,
        normalizeCtx
      );
      return toNodeResult(errOutput);
    }
  }
}
