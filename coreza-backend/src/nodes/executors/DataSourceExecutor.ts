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
import { getAllRegisteredDataSources, getDataSourceService } from "../../services/datasources";
import { RedisService } from "../../services/RedisService";
import { StoreService, StoreOperationParams } from "../../services/StoreService";
import { normalizeOutput, createSuccessOutput, createErrorOutput } from "../../utils/normalizeOutput";
import { toNodeResult } from "../../utils/normalizeOutput";

export { StoreOperationParams };

export class DataSourceExecutor implements INodeExecutor {
  readonly category = "DataSource";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    const startTime = Date.now();
    try {
      const nodeName = node.subCategory ?? node.name;
      if (!nodeName) {
        const errOutput = createErrorOutput("Data source node name is missing", {
          nodeId: node.id,
          nodeName: node.name,
          category: this.category,
          startTime,
        });
        return toNodeResult(errOutput);
      }
      // Resolve and merge node parameters with input data
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };
      const operation = resolvedParams.operation ?? node.values?.operation;

      const combinedInput = {
        ...input,
        ...resolvedParams,
      };

      console.log(
        `🔍 [DataSource] Executing ${nodeName} with params:`,
        combinedInput
      );

      const userId = context?.userId || resolvedParams.user_id || input.user_id;
      const credentialId = resolvedParams.credential_id || input.credential_id;

      if (nodeName === "RedisStore") {
        const redisUserId = context?.userId || input.userId;
        const redisCredentialId = resolvedParams.credential_id;

        if (!redisUserId || !redisCredentialId) {
          const errOutput = createErrorOutput(
            "userId and credential_id are required for Redis operations",
            { nodeId: node.id, nodeName, category: this.category, startTime }
          );
          return toNodeResult(errOutput);
        }

        const result = await RedisService.execute({
          userId: redisUserId,
          credentialId: redisCredentialId,
          operation: resolvedParams.operation,
          scope: resolvedParams.scope,
          key: resolvedParams.key,
          value: resolvedParams.value,
          keyType: resolvedParams.keyType,
          pattern: resolvedParams.pattern,
          channel: resolvedParams.channel,
          hashField: resolvedParams.hashField,
          setMember: resolvedParams.setMember,
          popDirection: resolvedParams.popDirection,
          pushDirection: resolvedParams.pushDirection,
          members: resolvedParams.members,
          member: resolvedParams.member,
          otherKeys: resolvedParams.otherKeys,
          incrementBy: resolvedParams.incrementBy,
          startIndex: resolvedParams.startIndex,
          endIndex: resolvedParams.endIndex,
          index: resolvedParams.index,
          ttl: resolvedParams.ttl,
          score: resolvedParams.score,
          scoreMembers: resolvedParams.scoreMembers,
          withScores: resolvedParams.withScores,
          reverseOrder: resolvedParams.reverseOrder,
          minScore: resolvedParams.minScore,
          maxScore: resolvedParams.maxScore,
          channelPattern: resolvedParams.channelPattern,
          channels: resolvedParams.channels,
          workflowId: context?.workflowId || input.workflowId,
        });

        const normalized = normalizeOutput(result, {
          nodeId: node.id,
          nodeName,
          category: this.category,
          startTime,
        });
        return toNodeResult(normalized);
      }

      if (nodeName === "Store") {
        const result = await this.executeStoreNode(resolvedParams, context);
        const normalized = normalizeOutput(result, {
          nodeId: node.id,
          nodeName,
          category: this.category,
          startTime,
        });
        return toNodeResult(normalized);
      }

      if (!credentialId && !this.isCredentialOptional(nodeName)) {
        const errOutput = createErrorOutput(
          `${nodeName} credential_id is required`,
          { nodeId: node.id, nodeName, category: this.category, startTime }
        );
        return toNodeResult(errOutput);
      }

      const serviceKey = this.resolveServiceKey(nodeName);
      if (!serviceKey) {
        const errOutput = createErrorOutput(
          `Unsupported data source: ${nodeName}`,
          { nodeId: node.id, nodeName, category: this.category, startTime }
        );
        return toNodeResult(errOutput);
      }

      const resolvedOperation = this.resolveOperation(
        serviceKey,
        operation,
        resolvedParams
      );

      const dataSourceService = getDataSourceService(serviceKey);
      if (!dataSourceService) {
        const errOutput = createErrorOutput(
          `Unsupported data source: ${serviceKey}`,
          { nodeId: node.id, nodeName, category: this.category, startTime }
        );
        return toNodeResult(errOutput);
      }

      console.log(
        `📊 [DataSource] Executing ${serviceKey} with operation: ${resolvedOperation}`
      );

      const result = await dataSourceService.execute({
        user_id: userId || "system",
        credential_id: credentialId,
        operation: resolvedOperation,
        ...combinedInput,
      });

      if (!result.success) {
        const errOutput = createErrorOutput(
          result.error || `${nodeName} ${resolvedOperation} operation failed`,
          { nodeId: node.id, nodeName, category: this.category, startTime }
        );
        return toNodeResult(errOutput);
      }

      const successOutput = createSuccessOutput(result.data, {
        nodeId: node.id,
        nodeName,
        category: this.category,
        startTime,
      });
      return toNodeResult(successOutput);
    } catch (error) {
      const errOutput = createErrorOutput(
        error instanceof Error ? error : String(error),
        { nodeId: node.id, nodeName: node.name, category: this.category, startTime }
      );
      return toNodeResult(errOutput);
    }
  }

  async executeStoreNode(
    params: StoreOperationParams,
    context?: any
  ): Promise<NodeResult> {
    return StoreService.execute(params, {
      userId: context?.userId || params.workflow_id,
      workflowId: params.workflow_id || params.workflowId || context?.workflowId,
    });
  }

  private resolveServiceKey(dataSource: string): string | undefined {
    const directMatch = getDataSourceService(dataSource) ? dataSource : undefined;
    if (directMatch) {
      return directMatch;
    }

    const normalized = dataSource.toLowerCase();
    return getAllRegisteredDataSources().find(
      (key) => key.toLowerCase() === normalized
    );
  }

  private resolveOperation(
    serviceKey: string,
    operation: string | undefined,
    params: Record<string, any>
  ): string {
    if (
      params?.historical ||
      params?.start_date ||
      params?.end_date
    ) {
      return operation || (serviceKey === "yahoofinance" ? "get_history" : "get_quote");
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
