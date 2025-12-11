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
import { DataService } from "../../services/data";
import { RedisService } from "../../services/RedisService";
import { StoreService, StoreOperationParams } from "../../services/StoreService";

export { StoreOperationParams };

export class DataSourceExecutor implements INodeExecutor {
  readonly category = "DataSource";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      // Check both node.type and node.name since JSON definitions use 'name'
      const nodeName = node.name;
      const operation = node.values?.operation || "get_quote";

      // Resolve and merge node parameters with input data
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      // Special handling for backtesting - ensure historical data operations
      if (
        resolvedParams.historical ||
        resolvedParams.start_date ||
        resolvedParams.end_date
      ) {
        resolvedParams.operation = "get_historical_data";
      }

      const combinedInput = {
        ...input,
        ...resolvedParams,
      };

      console.log(
        `🔍 [DataSource] Executing ${nodeName} with params:`,
        combinedInput
      );

      let result;
      switch (nodeName) {
        case "FinnHub":
          result = await DataService.execute(
            "finnhub",
            resolvedParams.operation,
            combinedInput
          );
          break;
        case "YahooFinance":
          resolvedParams.operation = "get_history";
          result = await DataService.execute(
            "yahoofinance",
            resolvedParams.operation,
            combinedInput
          );
          break;
        case "RedisStore":
          const userId = context?.userId || input.userId;
          const credentialId = resolvedParams.credential_id;

          if (!userId || !credentialId) {
            return {
              success: false,
              error:
                "userId and credential_id are required for Redis operations",
            };
          }

          result = await RedisService.execute({
            userId,
            credentialId,
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
          break;
        case "Store":
          result = await this.executeStoreNode(resolvedParams, context);
          break;
        default:
          return {
            success: false,
            error: `Unsupported data source node type: ${nodeName}`,
          };
      }

      if (!result.success) {
        return {
          success: false,
          error:
            result.error ||
            `${nodeName} ${resolvedParams.operation} operation failed`,
        };
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: `Data source execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
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
}
