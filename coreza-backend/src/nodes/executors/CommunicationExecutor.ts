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
import { getCommunicationService } from "../../services/communication";
import {
  normalizeOutput,
  createErrorOutput,
  toNodeResult,
} from "../../utils/normalizeOutput";

export class CommunicationExecutor implements INodeExecutor {
  readonly category = "Communication";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const startTime = Date.now();
    const nodeName = node.name;
    const ctx = {
      nodeId: node.id,
      nodeName,
      category: this.category,
      startTime,
    };

    try {
      const operation = node.values?.operation || "send";
      const credential_id = node.values?.credential_id;
      const user_id = context.user_id;

      // Get service from registry (node.name is Gmail, WhatsApp, Telegram)
      const serviceKey = nodeName.toLowerCase();
      const service = getCommunicationService(serviceKey);

      if (!service) {
        const errOutput = createErrorOutput(
          `Unknown communication service: ${nodeName}`,
          ctx
        );
        return toNodeResult(errOutput);
      }

      // Resolve and merge node parameters with input data
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      // Execute via registry service
      const result = await service.execute({
        operation,
        user_id,
        credential_id,
        ...input,
        ...resolvedParams,
      });

      const normalized = normalizeOutput(result, ctx);
      return toNodeResult(normalized);
    } catch (error) {
      const errOutput = createErrorOutput(
        error instanceof Error ? error : String(error),
        ctx
      );
      return toNodeResult(errOutput);
    }
  }
}
