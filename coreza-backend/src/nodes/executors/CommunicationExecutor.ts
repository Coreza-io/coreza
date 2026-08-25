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
import { effectKey, runOnce } from "../../engine/idempotency/effectGuard";

export class CommunicationExecutor implements INodeExecutor {
  readonly category = "Communication";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    const nodeName = node.name;

    try {
      const operation = node.values?.operation || "send";
      const credential_id = node.values?.credential_id;
      const user_id = context.user_id;

      // Get service from registry (node.name is Gmail, WhatsApp, Telegram)
      const serviceKey = node.name!.toLowerCase();
      const service = getCommunicationService(serviceKey);

      if (!service) {
        const errOutput = createErrorOutput(
          `Unknown communication service: ${nodeName}`,
        );
        return toNodeResult(errOutput);
      }

      // Resolve and merge node parameters with input data
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      // Execute via registry service
      const executeEffect = () => service.execute({
          operation,
          user_id,
          credential_id,
          ...input,
          ...resolvedParams,
        });
      const result = context?.emissionId
        ? await runOnce(
          {
            userId: context.userId ?? user_id ?? "system",
            workflowId: context.workflowId ?? "manual",
            executionId: context.executionId ?? context.runId ?? "manual",
          },
          effectKey(context.emissionId, node.id, `${serviceKey}:${operation}`),
          executeEffect,
        )
        : await executeEffect();

      const normalized = normalizeOutput(result);
      return toNodeResult(normalized);
    } catch (error) {
      const errOutput = createErrorOutput(
        error instanceof Error
          ? error
          : typeof error === "object" && error !== null
            ? ((error as any).message ?? JSON.stringify(error))
            : String(error),
      );

      return toNodeResult(errOutput);
    }
  }
}
