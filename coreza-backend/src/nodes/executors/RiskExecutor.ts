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
import { RiskEngineService } from "../../nodes/logic/risk";
import { createSuccessOutput, createErrorOutput, toNodeResult, NormalizeContext } from "../../utils/normalizeOutput";

export class RiskExecutor implements INodeExecutor {
  readonly category = "Risk Management";
  readonly syncCapable = true;

  execute(node: WorkflowNode, input: NodeInput, context?: any): NodeResult {
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
