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
import { buildExecutionScopedKey } from "../../utils/executionKey";
import { RollingWindow } from "../../services/RollingWindow";

export class DataSourceExecutor implements INodeExecutor {
  readonly category = "DataSource";
  private scopedKeyCache = new Map<string, string>();
  private cachedRunId: string | null = null;
  // Pre-allocated reusable result template for RollingWindow hot path
  private _rollingWindowResult: NodeResult = {
    success: true,
    data: { window: null, count: 0, size: 0, isReady: false, remaining: 0, latest: null },
  };

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    try {
      const runId = context?.runId;
      if (runId && runId !== this.cachedRunId) {
        this.scopedKeyCache.clear();
        this.cachedRunId = runId;
      }
      const nodeName = node.subCategory ?? node.name;
      // Resolve and merge node parameters with input data
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      if (nodeName === "Store") {
        const result = await this.executeStoreNode(resolvedParams, context);
        return result;
      }

      if (nodeName === "RollingWindow") {
        return this.executeRollingWindowNode(node, resolvedParams, context);
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

  private executeRollingWindowNode(
    node: WorkflowNode,
    params: Record<string, any>,
    context?: any,
  ): NodeResult {
    const size = Math.min(Math.max(parseInt(params.size) || 20, 1), 500);
    const symbol = params.symbol || "_";
    const timeframe = params.timeframe || "_";

    const userId = context?.userId || params.user_id || "system";
    const workflowId = context?.workflowId || params.workflow_id || "manual";
    const runId = context?.runId || params.run_id || "manual";

    let storeKey = this.scopedKeyCache.get(node.id);
    if (!storeKey) {
      storeKey = buildExecutionScopedKey({
        userId,
        workflowId,
        runId,
        nodeId: node.id,
        scope: "rolling_window",
        parts: [symbol, timeframe],
      });
      this.scopedKeyCache.set(node.id, storeKey);
    }
    const dataContext = context?.dataContext;

    let window: any;
    if (dataContext) {
      window = dataContext.getDataByKey(storeKey);
      if (!window || window.size !== size) {
        window = new RollingWindow(size);
        dataContext.setData(storeKey, window);
      }
    } else {
      window = new RollingWindow(size);
    }

    let bars: any[];
    const rawCandle = params.candle_data;
    if (
      rawCandle &&
      typeof rawCandle === "object" &&
      !Array.isArray(rawCandle)
    ) {
      bars = [rawCandle];
    } else if (Array.isArray(rawCandle)) {
      bars = rawCandle;
    } else if (typeof rawCandle === "string") {
      try {
        const parsed = JSON.parse(rawCandle);
        bars = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        bars = [];
      }
    } else {
      bars = [];
    }

    if (bars.length === 0) {
      return toNodeResult(
        createErrorOutput("No bars provided in candle_data", {
          nodeId: node.id,
          nodeName: "RollingWindow",
          category: this.category,
        }),
      );
    }

    for (const bar of bars) {
      window.add(bar);
    }

    // Reuse pre-allocated result object to avoid per-bar allocations
    const rw = this._rollingWindowResult;
    rw.data.window = window.values();
    rw.data.count = window.count;
    rw.data.size = window.size;
    rw.data.isReady = window.isReady;
    rw.data.remaining = window.size - window.count;
    rw.data.latest = window.count > 0 ? window.at(0) : null;
    return rw;
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
