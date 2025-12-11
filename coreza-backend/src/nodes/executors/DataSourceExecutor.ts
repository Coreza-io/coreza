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
import { getRedisCache } from "../../config/redis";
import {
  buildStoreKey,
  extractVariableNameFromKey,
  getStoreValue,
  setStoreValue,
  parseStoredValue,
  parseMembers,
  parseScoreMembers,
} from "../../utils/store";

export interface StoreOperationParams {
  workflow_id?: string;
  workflowId?: string;
  operation: string;
  variableName?: string;
  variableNameManual?: string;
  variableNameSelect?: string;
  variableSource?: string;
  sourceWorkflowId?: string;
  value?: any;
  hashField?: string;
  members?: string;
  member?: string;
  score?: number;
  scoreMembers?: string;
  startIndex?: number;
  endIndex?: number;
  index?: number;
  incrementBy?: number;
  minScore?: number | string;
  maxScore?: number | string;
  pattern?: string;
  otherKeys?: string[];
  withScores?: boolean;
  reverseOrder?: boolean;
  ttl?: number;
}

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
    const userId = context?.userId || params.workflow_id;
    const workflowId = params.workflow_id || params.workflowId || context?.workflowId;
    const operation = params.operation;
    
    // Determine variable name: manual entry, dropdown select, or direct
    const varName = params.variableNameManual || params.variableNameSelect || params.variableName;
    
    // Determine target workflow for read operations
    const targetWorkflowId =
      params.variableSource === "store" && params.sourceWorkflowId
        ? params.sourceWorkflowId
        : workflowId;

    if (!userId) {
      return { success: false, error: "userId is required for Store operations" };
    }

    const redis = getRedisCache();

    // Helper to apply TTL
    const applyTTL = async (key: string) => {
      if (params.ttl && params.ttl > 0) {
        await redis.expire(key, params.ttl);
      }
    };

    // ============ STRING OPERATIONS ============
    if (operation === "set") {
      if (!workflowId || !params.variableName) {
        return { success: false, error: "workflow_id and variableName required for set" };
      }
      const key = buildStoreKey(userId, workflowId, params.variableName);
      await setStoreValue(redis, key, params.value, params.ttl);
      return {
        success: true,
        data: { operation, variableName: params.variableName, message: "Value saved" },
      };
    }

    if (operation === "get") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for get" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const storedValue = await getStoreValue(redis, key);
      return {
        success: true,
        data: { operation, variableName: varName, value: storedValue },
      };
    }

    if (operation === "delete") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for delete" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      await redis.del(key);
      return {
        success: true,
        data: { operation, variableName: varName, message: "Key deleted" },
      };
    }

    if (operation === "increment") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for increment" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const amount = params.incrementBy || 1;
      const newValue = await redis.incrby(key, amount);
      return {
        success: true,
        data: { operation, variableName: varName, value: newValue },
      };
    }

    if (operation === "append") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for append" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      await redis.append(key, params.value || "");
      return {
        success: true,
        data: { operation, variableName: varName, message: "Value appended" },
      };
    }

    // ============ LIST OPERATIONS ============
    if (operation === "lpush") {
      if (!workflowId || !params.variableName) {
        return { success: false, error: "workflow_id and variableName required for lpush" };
      }
      const key = buildStoreKey(userId, workflowId, params.variableName);
      const serialized = typeof params.value === "string" ? params.value : JSON.stringify(params.value);
      await redis.lpush(key, serialized);
      await applyTTL(key);
      return {
        success: true,
        data: { operation, variableName: params.variableName, message: "Value pushed left" },
      };
    }

    if (operation === "rpush") {
      if (!workflowId || !params.variableName) {
        return { success: false, error: "workflow_id and variableName required for rpush" };
      }
      const key = buildStoreKey(userId, workflowId, params.variableName);
      const serialized = typeof params.value === "string" ? params.value : JSON.stringify(params.value);
      await redis.rpush(key, serialized);
      await applyTTL(key);
      return {
        success: true,
        data: { operation, variableName: params.variableName, message: "Value pushed right" },
      };
    }

    if (operation === "lpop") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for lpop" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const popped = await redis.lpop(key);
      return {
        success: true,
        data: { operation, variableName: varName, value: parseStoredValue(popped) },
      };
    }

    if (operation === "rpop") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for rpop" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const popped = await redis.rpop(key);
      return {
        success: true,
        data: { operation, variableName: varName, value: parseStoredValue(popped) },
      };
    }

    if (operation === "lrange") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for lrange" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const start = params.startIndex ?? 0;
      const end = params.endIndex ?? -1;
      const items = await redis.lrange(key, start, end);
      return {
        success: true,
        data: { operation, variableName: varName, value: items.map(parseStoredValue) },
      };
    }

    if (operation === "llen") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for llen" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const length = await redis.llen(key);
      return {
        success: true,
        data: { operation, variableName: varName, value: length },
      };
    }

    if (operation === "lindex") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for lindex" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const item = await redis.lindex(key, params.index ?? 0);
      return {
        success: true,
        data: { operation, variableName: varName, value: parseStoredValue(item) },
      };
    }

    if (operation === "lset") {
      if (!workflowId || !params.variableName) {
        return { success: false, error: "workflow_id and variableName required for lset" };
      }
      const key = buildStoreKey(userId, workflowId, params.variableName);
      const serialized = typeof params.value === "string" ? params.value : JSON.stringify(params.value);
      await redis.lset(key, params.index ?? 0, serialized);
      return {
        success: true,
        data: { operation, variableName: params.variableName, message: "Value set at index" },
      };
    }

    if (operation === "ltrim") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for ltrim" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const start = params.startIndex ?? 0;
      const end = params.endIndex ?? -1;
      await redis.ltrim(key, start, end);
      return {
        success: true,
        data: { operation, variableName: varName, message: "List trimmed" },
      };
    }

    // ============ HASH OPERATIONS ============
    if (operation === "hset") {
      if (!workflowId || !params.variableName || !params.hashField) {
        return { success: false, error: "workflow_id, variableName, and hashField required for hset" };
      }
      const key = buildStoreKey(userId, workflowId, params.variableName);
      const serialized = typeof params.value === "string" ? params.value : JSON.stringify(params.value);
      await redis.hset(key, params.hashField, serialized);
      await applyTTL(key);
      return {
        success: true,
        data: { operation, variableName: params.variableName, hashField: params.hashField, message: "Hash field set" },
      };
    }

    if (operation === "hget") {
      if (!targetWorkflowId || !varName || !params.hashField) {
        return { success: false, error: "workflow_id, variableName, and hashField required for hget" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const fieldValue = await redis.hget(key, params.hashField);
      return {
        success: true,
        data: { operation, variableName: varName, hashField: params.hashField, value: parseStoredValue(fieldValue) },
      };
    }

    if (operation === "hgetall") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for hgetall" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const hash = await redis.hgetall(key);
      const parsed: Record<string, any> = {};
      for (const [field, val] of Object.entries(hash)) {
        parsed[field] = parseStoredValue(val);
      }
      return {
        success: true,
        data: { operation, variableName: varName, value: parsed },
      };
    }

    if (operation === "hdel") {
      if (!targetWorkflowId || !varName || !params.hashField) {
        return { success: false, error: "workflow_id, variableName, and hashField required for hdel" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      await redis.hdel(key, params.hashField);
      return {
        success: true,
        data: { operation, variableName: varName, hashField: params.hashField, message: "Hash field deleted" },
      };
    }

    if (operation === "hkeys") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for hkeys" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const keys = await redis.hkeys(key);
      return {
        success: true,
        data: { operation, variableName: varName, value: keys },
      };
    }

    if (operation === "hvals") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for hvals" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const vals = await redis.hvals(key);
      return {
        success: true,
        data: { operation, variableName: varName, value: vals.map(parseStoredValue) },
      };
    }

    if (operation === "hexists") {
      if (!targetWorkflowId || !varName || !params.hashField) {
        return { success: false, error: "workflow_id, variableName, and hashField required for hexists" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const exists = await redis.hexists(key, params.hashField);
      return {
        success: true,
        data: { operation, variableName: varName, hashField: params.hashField, value: exists === 1 },
      };
    }

    if (operation === "hincrby") {
      if (!targetWorkflowId || !varName || !params.hashField) {
        return { success: false, error: "workflow_id, variableName, and hashField required for hincrby" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const amount = params.incrementBy || 1;
      const newValue = await redis.hincrby(key, params.hashField, amount);
      return {
        success: true,
        data: { operation, variableName: varName, hashField: params.hashField, value: newValue },
      };
    }

    // ============ SET OPERATIONS ============
    if (operation === "sadd") {
      if (!workflowId || !params.variableName) {
        return { success: false, error: "workflow_id and variableName required for sadd" };
      }
      const key = buildStoreKey(userId, workflowId, params.variableName);
      const memberList = parseMembers(params.members || "");
      if (memberList.length === 0) {
        return { success: false, error: "members required for sadd" };
      }
      await redis.sadd(key, ...memberList);
      await applyTTL(key);
      return {
        success: true,
        data: { operation, variableName: params.variableName, message: `Added ${memberList.length} member(s)` },
      };
    }

    if (operation === "srem") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for srem" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const memberList = parseMembers(params.members || "");
      if (memberList.length === 0) {
        return { success: false, error: "members required for srem" };
      }
      await redis.srem(key, ...memberList);
      return {
        success: true,
        data: { operation, variableName: varName, message: `Removed ${memberList.length} member(s)` },
      };
    }

    if (operation === "smembers") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for smembers" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const setMembers = await redis.smembers(key);
      return {
        success: true,
        data: { operation, variableName: varName, value: setMembers.map(parseStoredValue) },
      };
    }

    if (operation === "sismember") {
      if (!targetWorkflowId || !varName || !params.member) {
        return { success: false, error: "workflow_id, variableName, and member required for sismember" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const isMember = await redis.sismember(key, params.member);
      return {
        success: true,
        data: { operation, variableName: varName, member: params.member, value: isMember === 1 },
      };
    }

    if (operation === "scard") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for scard" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const count = await redis.scard(key);
      return {
        success: true,
        data: { operation, variableName: varName, value: count },
      };
    }

    if (operation === "sinter" || operation === "sunion" || operation === "sdiff") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for set operations" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const otherKeysList = Array.isArray(params.otherKeys) ? params.otherKeys : [];
      const allKeys = [key, ...otherKeysList.map((k: string) => buildStoreKey(userId, targetWorkflowId, k))];

      let result: string[];
      if (operation === "sinter") {
        result = await redis.sinter(...allKeys);
      } else if (operation === "sunion") {
        result = await redis.sunion(...allKeys);
      } else {
        result = await redis.sdiff(...allKeys);
      }

      return {
        success: true,
        data: { operation, variableName: varName, value: result.map(parseStoredValue) },
      };
    }

    // ============ SORTED SET OPERATIONS ============
    if (operation === "zadd") {
      if (!workflowId || !params.variableName) {
        return { success: false, error: "workflow_id and variableName required for zadd" };
      }
      const key = buildStoreKey(userId, workflowId, params.variableName);
      const scoreMembersList = parseScoreMembers(params.scoreMembers || "");
      if (scoreMembersList.length === 0) {
        return { success: false, error: "scoreMembers required for zadd" };
      }
      await redis.zadd(key, ...scoreMembersList);
      await applyTTL(key);
      return {
        success: true,
        data: { operation, variableName: params.variableName, message: `Added ${scoreMembersList.length / 2} member(s)` },
      };
    }

    if (operation === "zrange") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for zrange" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const start = params.startIndex ?? 0;
      const end = params.endIndex ?? -1;

      let result: string[];
      if (params.reverseOrder) {
        result = params.withScores
          ? await redis.zrevrange(key, start, end, "WITHSCORES")
          : await redis.zrevrange(key, start, end);
      } else {
        result = params.withScores
          ? await redis.zrange(key, start, end, "WITHSCORES")
          : await redis.zrange(key, start, end);
      }

      return {
        success: true,
        data: { operation, variableName: varName, value: result.map(parseStoredValue) },
      };
    }

    if (operation === "zscore") {
      if (!targetWorkflowId || !varName || !params.member) {
        return { success: false, error: "workflow_id, variableName, and member required for zscore" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const scoreVal = await redis.zscore(key, params.member);
      return {
        success: true,
        data: { operation, variableName: varName, member: params.member, value: scoreVal ? parseFloat(scoreVal) : null },
      };
    }

    if (operation === "zcount") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for zcount" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const min = params.minScore ?? "-inf";
      const max = params.maxScore ?? "+inf";
      const count = await redis.zcount(key, min, max);
      return {
        success: true,
        data: { operation, variableName: varName, value: count },
      };
    }

    if (operation === "zincrby") {
      if (!targetWorkflowId || !varName || !params.member) {
        return { success: false, error: "workflow_id, variableName, and member required for zincrby" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const amount = params.incrementBy || 1;
      const newScore = await redis.zincrby(key, amount, params.member);
      return {
        success: true,
        data: { operation, variableName: varName, member: params.member, value: parseFloat(newScore) },
      };
    }

    if (operation === "zrem") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for zrem" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const memberList = parseMembers(params.members || "");
      if (memberList.length === 0) {
        return { success: false, error: "members required for zrem" };
      }
      await redis.zrem(key, ...memberList);
      return {
        success: true,
        data: { operation, variableName: varName, message: `Removed ${memberList.length} member(s)` },
      };
    }

    // ============ UTILITY OPERATIONS ============
    if (operation === "keys") {
      const keyPattern = params.pattern || "*";
      const keyPrefix = buildStoreKey(userId, targetWorkflowId || workflowId || "", "");
      const fullPattern = keyPrefix + keyPattern;
      const matchedKeys = await redis.keys(fullPattern);
      return {
        success: true,
        data: { operation, pattern: keyPattern, value: matchedKeys.map(extractVariableNameFromKey) },
      };
    }

    if (operation === "list") {
      // Legacy "list" operation - same as keys with "*" pattern
      if (!workflowId) {
        return { success: false, error: "workflow_id required for list" };
      }
      const pattern = buildStoreKey(userId, workflowId, "*");
      const keys = await redis.keys(pattern);
      return {
        success: true,
        data: { operation, variables: keys.map(extractVariableNameFromKey) },
      };
    }

    if (operation === "exists") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for exists" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const existsResult = await redis.exists(key);
      return {
        success: true,
        data: { operation, variableName: varName, value: existsResult === 1 },
      };
    }

    if (operation === "expire") {
      if (!targetWorkflowId || !varName || !params.ttl) {
        return { success: false, error: "workflow_id, variableName, and ttl required for expire" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      await redis.expire(key, params.ttl);
      return {
        success: true,
        data: { operation, variableName: varName, message: `TTL set to ${params.ttl} seconds` },
      };
    }

    if (operation === "ttl") {
      if (!targetWorkflowId || !varName) {
        return { success: false, error: "workflow_id and variableName required for ttl" };
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const ttlValue = await redis.ttl(key);
      return {
        success: true,
        data: { operation, variableName: varName, value: ttlValue },
      };
    }

    return { success: false, error: `Unknown Store operation: ${operation}` };
  }
}
