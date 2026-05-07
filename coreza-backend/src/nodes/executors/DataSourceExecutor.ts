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
import {
  getAllRegisteredDataSources,
  getDataSourceService,
} from "../../services/datasources";
import { getStorageService } from "../../services/storage";
import type { StorageInput } from "../../services/storage/types";
import {
  normalizeOutput,
  createSuccessOutput,
  createErrorOutput,
  leanSuccess,
} from "../../utils/normalizeOutput";
import { toNodeResult } from "../../utils/normalizeOutput";

export class DataSourceExecutor implements INodeExecutor {
  readonly category = "DataSource";
  readonly syncCapable = true;
  private cachedRunId: string | null = null;

  execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): NodeResult | Promise<NodeResult> {
    this.clearResultCachesForRun(context?.runId);
    return this.executeAsync(node, input, context);
  }

  private async executeAsync(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    try {
      this.clearResultCachesForRun(context?.runId);
      const nodeName = node.subCategory ?? node.name;
      // Resolve and merge node parameters with input data
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      if (nodeName === "Store") {
        const result = await this.executeStoreNode(resolvedParams, context);
        return result;
      }

      const operation = resolvedParams.operation ?? node.values?.operation;

      const combinedInput = {
        ...input,
        ...resolvedParams,
      };

      // console.log(
      //   `🔍 [DataSource] Executing ${nodeName} with params:`,
      //   combinedInput
      // );

      const userId = context?.userId || resolvedParams.user_id || input.user_id;
      const credentialId = resolvedParams.credential_id || input.credential_id;

      if (nodeName === "RedisStore") {
        const redisUserId = userId;
        const redisCredentialId = credentialId;

        if (!redisUserId || !redisCredentialId) {
          const errOutput = createErrorOutput(
            "userId and credential_id are required for Redis operations",
            { nodeId: node.id, nodeName, category: this.category },
          );
          return toNodeResult(errOutput);
        }

        const result = await this.executeStorageNode("redis", {
          ...resolvedParams,
          user_id: redisUserId,
          credential_id: redisCredentialId,
          workflow_id: context?.workflowId || input.workflowId,
          subCategory: "redis",
        });

        const normalized = normalizeOutput(result, {
          nodeId: node.id,
          nodeName,
          category: this.category,
        });
        return toNodeResult(normalized);
      }

      if (!credentialId && !this.isCredentialOptional(nodeName)) {
        const errOutput = createErrorOutput(
          `${nodeName} credential_id is required`,
          { nodeId: node.id, nodeName, category: this.category },
        );
        return toNodeResult(errOutput);
      }

      const serviceKey = this.resolveServiceKey(nodeName);
      if (!serviceKey) {
        const errOutput = createErrorOutput(
          `Unsupported data source: ${nodeName}`,
          { nodeId: node.id, nodeName, category: this.category },
        );
        return toNodeResult(errOutput);
      }

      const resolvedOperation = this.resolveOperation(
        serviceKey,
        operation,
        resolvedParams,
      );

      const dataSourceService = getDataSourceService(serviceKey);
      if (!dataSourceService) {
        const errOutput = createErrorOutput(
          `Unsupported data source: ${serviceKey}`,
          { nodeId: node.id, nodeName, category: this.category },
        );
        return toNodeResult(errOutput);
      }

      // console.log(
      //   `📊 [DataSource] Executing ${serviceKey} with operation: ${resolvedOperation}`
      // );

      const result = await dataSourceService.execute({
        user_id: userId || "system",
        credential_id: credentialId,
        operation: resolvedOperation,
        ...combinedInput,
      });

      if (!result.success) {
        const errOutput = createErrorOutput(
          result.error || `${nodeName} ${resolvedOperation} operation failed`,
          { nodeId: node.id, nodeName, category: this.category },
        );
        return toNodeResult(errOutput);
      }

      const successOutput = createSuccessOutput(result.data, {
        nodeId: node.id,
        nodeName,
        category: this.category,
      });
      return toNodeResult(successOutput);
    } catch (error) {
      const errOutput = createErrorOutput(
        error instanceof Error ? error : String(error),
        {
          nodeId: node.id,
          nodeName: node.name,
          category: this.category,
        },
      );
      return toNodeResult(errOutput);
    }
  }

  async executeStoreNode(
    params: StorageInput,
    context?: any,
  ): Promise<NodeResult> {
    return this.executeStorageNode("store", params, context);
  }

  private async executeStorageNode(
    serviceKey: string,
    params: StorageInput,
    context?: any,
  ): Promise<NodeResult> {
    const storageService = getStorageService(serviceKey);
    if (!storageService) {
      return {
        success: false,
        error: `Unsupported storage service: ${serviceKey}`,
      };
    }

    params.user_id =
      params.user_id || context?.userId || (params as any).userId || "system";
    params.workflow_id =
      params.workflow_id || params.workflowId || context?.workflowId;

    return storageService.execute(params);
  }

  private clearResultCachesForRun(runId?: string): void {
    if (runId && runId !== this.cachedRunId) {
      this.cachedRunId = runId;
    }
  }

  private resolveServiceKey(dataSource: string): string | undefined {
    const directMatch = getDataSourceService(dataSource)
      ? dataSource
      : undefined;
    if (directMatch) {
      return directMatch;
    }

    const normalized = dataSource.toLowerCase();
    return getAllRegisteredDataSources().find(
      (key) => key.toLowerCase() === normalized,
    );
  }

  private resolveOperation(
    serviceKey: string,
    operation: string | undefined,
    params: Record<string, any>,
  ): string {
    if (params?.historical || params?.start_date || params?.end_date) {
      return (
        operation ||
        (serviceKey === "yahoofinance" ? "get_history" : "get_quote")
      );
    }

    if (operation) {
      return operation;
    }

    if (serviceKey === "yahoofinance") {
      return "get_history";
    }

    return "get_quote";
  }

  private isCredentialOptional(nodeName: string): boolean {
    return ["yahoofinance"].includes(nodeName.toLowerCase());
  }
}
