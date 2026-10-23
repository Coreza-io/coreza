import { serviceNodeResult } from "../serviceNodeResult";
import { resultFailure } from "../../contracts/nodeResult";
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
import { getScreenerService } from "../../services/screeners";
import { finalizeNodeResult, createErrorOutput } from "../../utils/nodeResultHelpers";

export class ScreenerExecutor implements INodeExecutor {
  readonly category = "Screener";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    try {
      const operation = node.values?.operation;
      const screener = node.subCategory ?? node.name ?? "";
      const credential_id = node.values?.credential_id;

      // Credential is optional for manual screeners
      if (!credential_id && screener !== "YahooFinance") {
        return resultFailure(`${screener || "Screener"} credential_id is required`, { data: null });
      }

      // Resolve and merge node parameters with input data
      console.log(
        `📊 [SCREENER] Starting parameter resolution for node ${node.id}`,
      );
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };
      console.log(
        `📊 [SCREENER] Parameter resolution completed for node ${node.id}`,
      );

      const screenerService = getScreenerService(screener.toLowerCase());
      if (!screenerService) {
        return resultFailure(`Unsupported screener: ${screener}`, { data: null });
      }

      console.log(
        `📊 [SCREENER] Executing ${screener} screener with operation: ${operation}`,
      );
      const result = await screenerService.execute({
        user_id: context?.userId,
        credential_id,
        operation,
        ...resolvedParams,
        input,
      });

      return finalizeNodeResult(serviceNodeResult(result), { nodeId: node.id, nodeName: screener, category: this.category }, "observed");
    } catch (error) {
      console.error("[SCREENER] Execution error:", error);

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
          startTime,
        },
      );

      return errOutput;
    }
  }
}
