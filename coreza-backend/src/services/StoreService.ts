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

import { getRedisCache } from "../config/redis";
import {
  buildStoreKey,
  extractVariableNameFromKey,
  getStoreValue,
  setStoreValue,
  parseStoredValue,
  parseMembers,
  parseScoreMembers,
} from "../utils/store";
import { createSuccessOutput, createErrorOutput } from "../utils/normalizeOutput";
import type { StandardNodeOutput } from "../types/nodeOutput";

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

export interface StoreContext {
  userId?: string;
  workflowId?: string;
}

const STORE_CONTEXT = { nodeName: 'Store', category: 'data' };

export class StoreService {
  static async execute(
    params: StoreOperationParams,
    context?: StoreContext
  ): Promise<StandardNodeOutput> {
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
      return createErrorOutput("userId is required for Store operations", STORE_CONTEXT);
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
        return createErrorOutput("workflow_id and variableName required for set", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, workflowId, params.variableName);
      await setStoreValue(redis, key, params.value, params.ttl);
      return createSuccessOutput({ operation, variableName: params.variableName, message: "Value saved" }, STORE_CONTEXT);
    }

    if (operation === "get") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for get", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const storedValue = await getStoreValue(redis, key);
      return createSuccessOutput({ operation, variableName: varName, value: storedValue }, STORE_CONTEXT);
    }

    if (operation === "delete") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for delete", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      await redis.del(key);
      return createSuccessOutput({ operation, variableName: varName, message: "Key deleted" }, STORE_CONTEXT);
    }

    if (operation === "increment") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for increment", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const amount = params.incrementBy || 1;
      const newValue = await redis.incrby(key, amount);
      return createSuccessOutput({ operation, variableName: varName, value: newValue }, STORE_CONTEXT);
    }

    if (operation === "append") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for append", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      await redis.append(key, params.value || "");
      return createSuccessOutput({ operation, variableName: varName, message: "Value appended" }, STORE_CONTEXT);
    }

    // ============ LIST OPERATIONS ============
    if (operation === "lpush") {
      if (!workflowId || !params.variableName) {
        return createErrorOutput("workflow_id and variableName required for lpush", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, workflowId, params.variableName);
      const serialized = typeof params.value === "string" ? params.value : JSON.stringify(params.value);
      await redis.lpush(key, serialized);
      await applyTTL(key);
      return createSuccessOutput({ operation, variableName: params.variableName, message: "Value pushed left" }, STORE_CONTEXT);
    }

    if (operation === "rpush") {
      if (!workflowId || !params.variableName) {
        return createErrorOutput("workflow_id and variableName required for rpush", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, workflowId, params.variableName);
      const serialized = typeof params.value === "string" ? params.value : JSON.stringify(params.value);
      await redis.rpush(key, serialized);
      await applyTTL(key);
      return createSuccessOutput({ operation, variableName: params.variableName, message: "Value pushed right" }, STORE_CONTEXT);
    }

    if (operation === "lpop") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for lpop", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const popped = await redis.lpop(key);
      return createSuccessOutput({ operation, variableName: varName, value: parseStoredValue(popped) }, STORE_CONTEXT);
    }

    if (operation === "rpop") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for rpop", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const popped = await redis.rpop(key);
      return createSuccessOutput({ operation, variableName: varName, value: parseStoredValue(popped) }, STORE_CONTEXT);
    }

    if (operation === "lrange") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for lrange", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const start = params.startIndex ?? 0;
      const end = params.endIndex ?? -1;
      const items = await redis.lrange(key, start, end);
      return createSuccessOutput({ operation, variableName: varName, value: items.map(parseStoredValue) }, STORE_CONTEXT);
    }

    if (operation === "llen") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for llen", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const length = await redis.llen(key);
      return createSuccessOutput({ operation, variableName: varName, value: length }, STORE_CONTEXT);
    }

    if (operation === "lindex") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for lindex", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const item = await redis.lindex(key, params.index ?? 0);
      return createSuccessOutput({ operation, variableName: varName, value: parseStoredValue(item) }, STORE_CONTEXT);
    }

    if (operation === "lset") {
      if (!workflowId || !params.variableName) {
        return createErrorOutput("workflow_id and variableName required for lset", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, workflowId, params.variableName);
      const serialized = typeof params.value === "string" ? params.value : JSON.stringify(params.value);
      await redis.lset(key, params.index ?? 0, serialized);
      return createSuccessOutput({ operation, variableName: params.variableName, message: "Value set at index" }, STORE_CONTEXT);
    }

    if (operation === "ltrim") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for ltrim", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const start = params.startIndex ?? 0;
      const end = params.endIndex ?? -1;
      await redis.ltrim(key, start, end);
      return createSuccessOutput({ operation, variableName: varName, message: "List trimmed" }, STORE_CONTEXT);
    }

    // ============ HASH OPERATIONS ============
    if (operation === "hset") {
      if (!workflowId || !params.variableName || !params.hashField) {
        return createErrorOutput("workflow_id, variableName, and hashField required for hset", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, workflowId, params.variableName);
      const serialized = typeof params.value === "string" ? params.value : JSON.stringify(params.value);
      await redis.hset(key, params.hashField, serialized);
      await applyTTL(key);
      return createSuccessOutput({ operation, variableName: params.variableName, hashField: params.hashField, message: "Hash field set" }, STORE_CONTEXT);
    }

    if (operation === "hget") {
      if (!targetWorkflowId || !varName || !params.hashField) {
        return createErrorOutput("workflow_id, variableName, and hashField required for hget", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const fieldValue = await redis.hget(key, params.hashField);
      return createSuccessOutput({ operation, variableName: varName, hashField: params.hashField, value: parseStoredValue(fieldValue) }, STORE_CONTEXT);
    }

    if (operation === "hgetall") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for hgetall", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const hash = await redis.hgetall(key);
      const parsed: Record<string, any> = {};
      for (const [field, val] of Object.entries(hash)) {
        parsed[field] = parseStoredValue(val);
      }
      return createSuccessOutput({ operation, variableName: varName, value: parsed }, STORE_CONTEXT);
    }

    if (operation === "hdel") {
      if (!targetWorkflowId || !varName || !params.hashField) {
        return createErrorOutput("workflow_id, variableName, and hashField required for hdel", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      await redis.hdel(key, params.hashField);
      return createSuccessOutput({ operation, variableName: varName, hashField: params.hashField, message: "Hash field deleted" }, STORE_CONTEXT);
    }

    if (operation === "hkeys") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for hkeys", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const keys = await redis.hkeys(key);
      return createSuccessOutput({ operation, variableName: varName, value: keys }, STORE_CONTEXT);
    }

    if (operation === "hvals") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for hvals", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const vals = await redis.hvals(key);
      return createSuccessOutput({ operation, variableName: varName, value: vals.map(parseStoredValue) }, STORE_CONTEXT);
    }

    if (operation === "hexists") {
      if (!targetWorkflowId || !varName || !params.hashField) {
        return createErrorOutput("workflow_id, variableName, and hashField required for hexists", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const exists = await redis.hexists(key, params.hashField);
      return createSuccessOutput({ operation, variableName: varName, hashField: params.hashField, value: exists === 1 }, STORE_CONTEXT);
    }

    if (operation === "hincrby") {
      if (!targetWorkflowId || !varName || !params.hashField) {
        return createErrorOutput("workflow_id, variableName, and hashField required for hincrby", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const amount = params.incrementBy || 1;
      const newValue = await redis.hincrby(key, params.hashField, amount);
      return createSuccessOutput({ operation, variableName: varName, hashField: params.hashField, value: newValue }, STORE_CONTEXT);
    }

    // ============ SET OPERATIONS ============
    if (operation === "sadd") {
      if (!workflowId || !params.variableName) {
        return createErrorOutput("workflow_id and variableName required for sadd", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, workflowId, params.variableName);
      const memberList = parseMembers(params.members || "");
      if (memberList.length === 0) {
        return createErrorOutput("members required for sadd", STORE_CONTEXT);
      }
      await redis.sadd(key, ...memberList);
      await applyTTL(key);
      return createSuccessOutput({ operation, variableName: params.variableName, message: `Added ${memberList.length} member(s)` }, STORE_CONTEXT);
    }

    if (operation === "srem") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for srem", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const memberList = parseMembers(params.members || "");
      if (memberList.length === 0) {
        return createErrorOutput("members required for srem", STORE_CONTEXT);
      }
      await redis.srem(key, ...memberList);
      return createSuccessOutput({ operation, variableName: varName, message: `Removed ${memberList.length} member(s)` }, STORE_CONTEXT);
    }

    if (operation === "smembers") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for smembers", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const setMembers = await redis.smembers(key);
      return createSuccessOutput({ operation, variableName: varName, value: setMembers.map(parseStoredValue) }, STORE_CONTEXT);
    }

    if (operation === "sismember") {
      if (!targetWorkflowId || !varName || !params.member) {
        return createErrorOutput("workflow_id, variableName, and member required for sismember", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const isMember = await redis.sismember(key, params.member);
      return createSuccessOutput({ operation, variableName: varName, member: params.member, value: isMember === 1 }, STORE_CONTEXT);
    }

    if (operation === "scard") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for scard", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const count = await redis.scard(key);
      return createSuccessOutput({ operation, variableName: varName, value: count }, STORE_CONTEXT);
    }

    if (operation === "sinter" || operation === "sunion" || operation === "sdiff") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for set operations", STORE_CONTEXT);
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

      return createSuccessOutput({ operation, variableName: varName, value: result.map(parseStoredValue) }, STORE_CONTEXT);
    }

    // ============ SORTED SET OPERATIONS ============
    if (operation === "zadd") {
      if (!workflowId || !params.variableName) {
        return createErrorOutput("workflow_id and variableName required for zadd", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, workflowId, params.variableName);
      
      // Mode 1: Single score + member (preferred for dynamic expressions)
      if (params.score !== undefined && params.member) {
        const score = parseFloat(String(params.score));
        if (isNaN(score)) {
          return createErrorOutput("Score must be a valid number", STORE_CONTEXT);
        }
        // Serialize member if it's an object
        const memberValue = typeof params.member === 'object' 
          ? JSON.stringify(params.member) 
          : String(params.member);
        
        await redis.zadd(key, score, memberValue);
        await applyTTL(key);
        return createSuccessOutput({ 
          operation, 
          variableName: params.variableName, 
          score,
          member: memberValue,
          message: "Member added to sorted set" 
        }, STORE_CONTEXT);
      }
      
      // Mode 2: Batch scoreMembers format (backwards compatible)
      const scoreMembersList = parseScoreMembers(params.scoreMembers || "");
      if (scoreMembersList.length === 0) {
        return createErrorOutput("score and member are required for zadd", STORE_CONTEXT);
      }
      await redis.zadd(key, ...scoreMembersList);
      await applyTTL(key);
      return createSuccessOutput({ operation, variableName: params.variableName, message: `Added ${scoreMembersList.length / 2} member(s)` }, STORE_CONTEXT);
    }

    if (operation === "zrange") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for zrange", STORE_CONTEXT);
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

      return createSuccessOutput({ operation, variableName: varName, value: result.map(parseStoredValue) }, STORE_CONTEXT);
    }

    if (operation === "zscore") {
      if (!targetWorkflowId || !varName || !params.member) {
        return createErrorOutput("workflow_id, variableName, and member required for zscore", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const scoreVal = await redis.zscore(key, params.member);
      return createSuccessOutput({ operation, variableName: varName, member: params.member, value: scoreVal ? parseFloat(scoreVal) : null }, STORE_CONTEXT);
    }

    if (operation === "zcount") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for zcount", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const min = params.minScore ?? "-inf";
      const max = params.maxScore ?? "+inf";
      const count = await redis.zcount(key, min, max);
      return createSuccessOutput({ operation, variableName: varName, value: count }, STORE_CONTEXT);
    }

    if (operation === "zincrby") {
      if (!targetWorkflowId || !varName || !params.member) {
        return createErrorOutput("workflow_id, variableName, and member required for zincrby", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const amount = params.incrementBy || 1;
      const newScore = await redis.zincrby(key, amount, params.member);
      return createSuccessOutput({ operation, variableName: varName, member: params.member, value: parseFloat(newScore) }, STORE_CONTEXT);
    }

    if (operation === "zrem") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for zrem", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const memberList = parseMembers(params.members || "");
      if (memberList.length === 0) {
        return createErrorOutput("members required for zrem", STORE_CONTEXT);
      }
      await redis.zrem(key, ...memberList);
      return createSuccessOutput({ operation, variableName: varName, message: `Removed ${memberList.length} member(s)` }, STORE_CONTEXT);
    }

    // ============ UTILITY OPERATIONS ============
    if (operation === "keys") {
      const keyPattern = params.pattern || "*";
      const keyPrefix = buildStoreKey(userId, targetWorkflowId || workflowId || "", "");
      const fullPattern = keyPrefix + keyPattern;
      const matchedKeys = await redis.keys(fullPattern);
      return createSuccessOutput({ operation, pattern: keyPattern, value: matchedKeys.map(extractVariableNameFromKey) }, STORE_CONTEXT);
    }

    if (operation === "list") {
      // Legacy "list" operation - same as keys with "*" pattern
      if (!workflowId) {
        return createErrorOutput("workflow_id required for list", STORE_CONTEXT);
      }
      const pattern = buildStoreKey(userId, workflowId, "*");
      const keys = await redis.keys(pattern);
      return createSuccessOutput({ operation, variables: keys.map(extractVariableNameFromKey) }, STORE_CONTEXT);
    }

    if (operation === "exists") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for exists", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const existsResult = await redis.exists(key);
      return createSuccessOutput({ operation, variableName: varName, value: existsResult === 1 }, STORE_CONTEXT);
    }

    if (operation === "expire") {
      if (!targetWorkflowId || !varName || !params.ttl) {
        return createErrorOutput("workflow_id, variableName, and ttl required for expire", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      await redis.expire(key, params.ttl);
      return createSuccessOutput({ operation, variableName: varName, message: `TTL set to ${params.ttl} seconds` }, STORE_CONTEXT);
    }

    if (operation === "ttl") {
      if (!targetWorkflowId || !varName) {
        return createErrorOutput("workflow_id and variableName required for ttl", STORE_CONTEXT);
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const ttlValue = await redis.ttl(key);
      return createSuccessOutput({ operation, variableName: varName, value: ttlValue }, STORE_CONTEXT);
    }

    return createErrorOutput(`Unknown Store operation: ${operation}`, STORE_CONTEXT);
  }
}
