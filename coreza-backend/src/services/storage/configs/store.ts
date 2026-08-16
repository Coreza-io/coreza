/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import type { StorageConfig, StorageInput, StorageContext } from "../types";
import {
  buildStoreKey,
  extractVariableNameFromKey,
  getStoreValue,
  setStoreValue,
  parseStoredValue,
  parseMembers,
  parseScoreMembers,
  parseStreamEntries,
} from "../../../utils/store";

// Helper to apply TTL
const applyTTL = async (redis: any, key: string, ttl?: number) => {
  const normalizedTtl = Number(ttl);
  if (
    Number.isFinite(normalizedTtl) &&
    normalizedTtl > 0 &&
    Number.isInteger(normalizedTtl)
  ) {
    try {
      await redis.expire(key, normalizedTtl);
    } catch {
      // The value has already been persisted; TTL is best-effort.
    }
  }
};

// Helper to get variable name from input
const getVarName = (input: StorageInput): string | undefined => {
  return (
    input.variableNameManual || input.variableNameSelect || input.variableName
  );
};

// Helper to get target workflow ID
const getTargetWorkflowId = (
  input: StorageInput,
  context: StorageContext,
): string | undefined => {
  return input.variableSource === "store" && input.sourceWorkflowId
    ? input.sourceWorkflowId
    : input.workflow_id || input.workflowId || context.workflowId;
};

export const storeConfig: StorageConfig = {
  requiresCredentials: false, // Uses internal Redis

  operations: {
    // ============ STRING OPERATIONS ============
    set: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const workflowId =
          input.workflow_id || input.workflowId || ctx.workflowId;
        if (!workflowId || !input.variableName) {
          throw new Error("workflow_id and variableName required for set");
        }
        const key = buildStoreKey(ctx.userId, workflowId, input.variableName);
        await setStoreValue(ctx.redis!, key, input.value, input.ttl);
        return {
          operation: "set",
          variableName: input.variableName,
          message: "Value saved",
        };
      },
      requiresKey: true,
      requiresValue: true,
    },

    get: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for get");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const storedValue = await getStoreValue(ctx.redis!, key);
        return { operation: "get", variableName: varName, value: storedValue };
      },
      requiresKey: true,
    },

    delete: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for delete");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        await ctx.redis!.del(key);
        return {
          operation: "delete",
          variableName: varName,
          message: "Key deleted",
        };
      },
      requiresKey: true,
    },

    increment: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error(
            "workflow_id and variableName required for increment",
          );
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const amount = input.incrementBy || 1;
        const newValue = await ctx.redis!.incrby(key, amount);
        return {
          operation: "increment",
          variableName: varName,
          value: newValue,
        };
      },
      requiresKey: true,
    },

    append: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for append");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        await ctx.redis!.append(key, input.value || "");
        return {
          operation: "append",
          variableName: varName,
          message: "Value appended",
        };
      },
      requiresKey: true,
    },

    // ============ LIST OPERATIONS ============
    lpush: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const workflowId =
          input.workflow_id || input.workflowId || ctx.workflowId;
        if (!workflowId || !input.variableName) {
          throw new Error("workflow_id and variableName required for lpush");
        }
        const key = buildStoreKey(ctx.userId, workflowId, input.variableName);
        const serialized =
          typeof input.value === "string"
            ? input.value
            : JSON.stringify(input.value);
        await ctx.redis!.lpush(key, serialized);
        await applyTTL(ctx.redis!, key, input.ttl);
        return {
          operation: "lpush",
          variableName: input.variableName,
          message: "Value pushed left",
        };
      },
    },

    rpush: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const workflowId =
          input.workflow_id || input.workflowId || ctx.workflowId;
        if (!workflowId || !input.variableName) {
          throw new Error("workflow_id and variableName required for rpush");
        }
        const key = buildStoreKey(ctx.userId, workflowId, input.variableName);
        const serialized =
          typeof input.value === "string"
            ? input.value
            : JSON.stringify(input.value);
        await ctx.redis!.rpush(key, serialized);
        await applyTTL(ctx.redis!, key, input.ttl);
        return {
          operation: "rpush",
          variableName: input.variableName,
          message: "Value pushed right",
        };
      },
    },

    lpop: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for lpop");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const popped = await ctx.redis!.lpop(key);
        return {
          operation: "lpop",
          variableName: varName,
          value: parseStoredValue(popped),
        };
      },
    },

    rpop: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for rpop");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const popped = await ctx.redis!.rpop(key);
        return {
          operation: "rpop",
          variableName: varName,
          value: parseStoredValue(popped),
        };
      },
    },

    lrange: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for lrange");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const start = input.startIndex ?? 0;
        const end = input.endIndex ?? -1;
        const items = await ctx.redis!.lrange(key, start, end);
        return {
          operation: "lrange",
          variableName: varName,
          value: items.map(parseStoredValue),
        };
      },
    },

    llen: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for llen");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const length = await ctx.redis!.llen(key);
        return { operation: "llen", variableName: varName, value: length };
      },
    },

    lindex: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for lindex");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const item = await ctx.redis!.lindex(key, input.index ?? 0);
        return {
          operation: "lindex",
          variableName: varName,
          value: parseStoredValue(item),
        };
      },
    },

    lset: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const workflowId =
          input.workflow_id || input.workflowId || ctx.workflowId;
        if (!workflowId || !input.variableName) {
          throw new Error("workflow_id and variableName required for lset");
        }
        const key = buildStoreKey(ctx.userId, workflowId, input.variableName);
        const serialized =
          typeof input.value === "string"
            ? input.value
            : JSON.stringify(input.value);
        await ctx.redis!.lset(key, input.index ?? 0, serialized);
        return {
          operation: "lset",
          variableName: input.variableName,
          message: "Value set at index",
        };
      },
    },

    ltrim: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for ltrim");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const start = input.startIndex ?? 0;
        const end = input.endIndex ?? -1;
        await ctx.redis!.ltrim(key, start, end);
        return {
          operation: "ltrim",
          variableName: varName,
          message: "List trimmed",
        };
      },
    },

    // ============ HASH OPERATIONS ============
    hset: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const workflowId =
          input.workflow_id || input.workflowId || ctx.workflowId;
        if (!workflowId || !input.variableName || !input.hashField) {
          throw new Error(
            "workflow_id, variableName, and hashField required for hset",
          );
        }
        const key = buildStoreKey(ctx.userId, workflowId, input.variableName);
        const serialized =
          typeof input.value === "string"
            ? input.value
            : JSON.stringify(input.value);
        await ctx.redis!.hset(key, input.hashField, serialized);
        await applyTTL(ctx.redis!, key, input.ttl);
        return {
          operation: "hset",
          variableName: input.variableName,
          hashField: input.hashField,
          message: "Hash field set",
        };
      },
    },

    hget: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName || !input.hashField) {
          throw new Error(
            "workflow_id, variableName, and hashField required for hget",
          );
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const fieldValue = await ctx.redis!.hget(key, input.hashField);
        return {
          operation: "hget",
          variableName: varName,
          hashField: input.hashField,
          value: parseStoredValue(fieldValue),
        };
      },
    },

    hgetall: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for hgetall");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const hash = await ctx.redis!.hgetall(key);
        const parsed: Record<string, any> = {};
        for (const [field, val] of Object.entries(hash)) {
          parsed[field] = parseStoredValue(val);
        }
        return { operation: "hgetall", variableName: varName, value: parsed };
      },
    },

    hdel: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName || !input.hashField) {
          throw new Error(
            "workflow_id, variableName, and hashField required for hdel",
          );
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        await ctx.redis!.hdel(key, input.hashField);
        return {
          operation: "hdel",
          variableName: varName,
          hashField: input.hashField,
          message: "Hash field deleted",
        };
      },
    },

    hkeys: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for hkeys");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const keys = await ctx.redis!.hkeys(key);
        return { operation: "hkeys", variableName: varName, value: keys };
      },
    },

    hvals: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for hvals");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const vals = await ctx.redis!.hvals(key);
        return {
          operation: "hvals",
          variableName: varName,
          value: vals.map(parseStoredValue),
        };
      },
    },

    hexists: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName || !input.hashField) {
          throw new Error(
            "workflow_id, variableName, and hashField required for hexists",
          );
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const exists = await ctx.redis!.hexists(key, input.hashField);
        return {
          operation: "hexists",
          variableName: varName,
          hashField: input.hashField,
          value: exists === 1,
        };
      },
    },

    hincrby: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName || !input.hashField) {
          throw new Error(
            "workflow_id, variableName, and hashField required for hincrby",
          );
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const amount = input.incrementBy || 1;
        const newValue = await ctx.redis!.hincrby(key, input.hashField, amount);
        return {
          operation: "hincrby",
          variableName: varName,
          hashField: input.hashField,
          value: newValue,
        };
      },
    },

    // ============ SET OPERATIONS ============
    sadd: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const workflowId =
          input.workflow_id || input.workflowId || ctx.workflowId;
        if (!workflowId || !input.variableName) {
          throw new Error("workflow_id and variableName required for sadd");
        }
        const key = buildStoreKey(ctx.userId, workflowId, input.variableName);
        const memberList = parseMembers((input.members as string) || "");
        if (memberList.length === 0) {
          throw new Error("members required for sadd");
        }
        await ctx.redis!.sadd(key, ...memberList);
        await applyTTL(ctx.redis!, key, input.ttl);
        return {
          operation: "sadd",
          variableName: input.variableName,
          message: `Added ${memberList.length} member(s)`,
        };
      },
    },

    srem: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for srem");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const memberList = parseMembers((input.members as string) || "");
        if (memberList.length === 0) {
          throw new Error("members required for srem");
        }
        await ctx.redis!.srem(key, ...memberList);
        return {
          operation: "srem",
          variableName: varName,
          message: `Removed ${memberList.length} member(s)`,
        };
      },
    },

    smembers: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for smembers");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const setMembers = await ctx.redis!.smembers(key);
        return {
          operation: "smembers",
          variableName: varName,
          value: setMembers.map(parseStoredValue),
        };
      },
    },

    sismember: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName || !input.member) {
          throw new Error(
            "workflow_id, variableName, and member required for sismember",
          );
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const isMember = await ctx.redis!.sismember(key, input.member);
        return {
          operation: "sismember",
          variableName: varName,
          member: input.member,
          value: isMember === 1,
        };
      },
    },

    scard: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for scard");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const count = await ctx.redis!.scard(key);
        return { operation: "scard", variableName: varName, value: count };
      },
    },

    sinter: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for sinter");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const otherKeysList = Array.isArray(input.otherKeys)
          ? input.otherKeys
          : [];
        const allKeys = [
          key,
          ...otherKeysList.map((k: string) =>
            buildStoreKey(ctx.userId, targetWorkflowId, k),
          ),
        ];
        const result = await ctx.redis!.sinter(...allKeys);
        return {
          operation: "sinter",
          variableName: varName,
          value: result.map(parseStoredValue),
        };
      },
    },

    sunion: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for sunion");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const otherKeysList = Array.isArray(input.otherKeys)
          ? input.otherKeys
          : [];
        const allKeys = [
          key,
          ...otherKeysList.map((k: string) =>
            buildStoreKey(ctx.userId, targetWorkflowId, k),
          ),
        ];
        const result = await ctx.redis!.sunion(...allKeys);
        return {
          operation: "sunion",
          variableName: varName,
          value: result.map(parseStoredValue),
        };
      },
    },

    sdiff: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for sdiff");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const otherKeysList = Array.isArray(input.otherKeys)
          ? input.otherKeys
          : [];
        const allKeys = [
          key,
          ...otherKeysList.map((k: string) =>
            buildStoreKey(ctx.userId, targetWorkflowId, k),
          ),
        ];
        const result = await ctx.redis!.sdiff(...allKeys);
        return {
          operation: "sdiff",
          variableName: varName,
          value: result.map(parseStoredValue),
        };
      },
    },

    // ============ SORTED SET OPERATIONS ============
    zadd: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const workflowId =
          input.workflow_id || input.workflowId || ctx.workflowId;
        if (!workflowId || !input.variableName) {
          throw new Error("workflow_id and variableName required for zadd");
        }
        const key = buildStoreKey(ctx.userId, workflowId, input.variableName);

        // Mode 1: Single score + member
        if (input.score !== undefined && input.member) {
          const score = parseFloat(String(input.score));
          if (isNaN(score)) {
            throw new Error("Score must be a valid number");
          }
          const memberValue =
            typeof input.member === "object"
              ? JSON.stringify(input.member)
              : String(input.member);
          await ctx.redis!.zadd(key, score, memberValue);
          await applyTTL(ctx.redis!, key, input.ttl);
          return {
            operation: "zadd",
            variableName: input.variableName,
            score,
            member: memberValue,
            message: "Member added to sorted set",
          };
        }

        // Mode 2: Batch scoreMembers format
        const scoreMembersList = parseScoreMembers(
          (input.scoreMembers as string) || "",
        );
        if (scoreMembersList.length === 0) {
          throw new Error("score and member are required for zadd");
        }
        await ctx.redis!.zadd(key, ...scoreMembersList);
        await applyTTL(ctx.redis!, key, input.ttl);
        return {
          operation: "zadd",
          variableName: input.variableName,
          message: `Added ${scoreMembersList.length / 2} member(s)`,
        };
      },
    },

    zrange: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for zrange");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const start = input.startIndex ?? 0;
        const end = input.endIndex ?? -1;

        let result: string[];
        if (input.reverseOrder) {
          result = input.withScores
            ? await ctx.redis!.zrevrange(key, start, end, "WITHSCORES")
            : await ctx.redis!.zrevrange(key, start, end);
        } else {
          result = input.withScores
            ? await ctx.redis!.zrange(key, start, end, "WITHSCORES")
            : await ctx.redis!.zrange(key, start, end);
        }

        return {
          operation: "zrange",
          variableName: varName,
          value: result.map(parseStoredValue),
        };
      },
    },

    zscore: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName || !input.member) {
          throw new Error(
            "workflow_id, variableName, and member required for zscore",
          );
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const scoreVal = await ctx.redis!.zscore(key, input.member);
        return {
          operation: "zscore",
          variableName: varName,
          member: input.member,
          value: scoreVal ? parseFloat(scoreVal) : null,
        };
      },
    },

    zcount: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for zcount");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const min = input.minScore ?? "-inf";
        const max = input.maxScore ?? "+inf";
        const count = await ctx.redis!.zcount(key, min, max);
        return { operation: "zcount", variableName: varName, value: count };
      },
    },

    zincrby: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName || !input.member) {
          throw new Error(
            "workflow_id, variableName, and member required for zincrby",
          );
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const amount = input.incrementBy || 1;
        const newScore = await ctx.redis!.zincrby(key, amount, input.member);
        return {
          operation: "zincrby",
          variableName: varName,
          member: input.member,
          value: parseFloat(newScore),
        };
      },
    },

    zrem: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for zrem");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const memberList = parseMembers((input.members as string) || "");
        if (memberList.length === 0) {
          throw new Error("members required for zrem");
        }
        await ctx.redis!.zrem(key, ...memberList);
        return {
          operation: "zrem",
          variableName: varName,
          message: `Removed ${memberList.length} member(s)`,
        };
      },
    },
    zadd_bulk: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const workflowId =
          input.workflow_id || input.workflowId || ctx.workflowId;
        if (!workflowId || !input.variableName) {
          throw new Error(
            "workflow_id and variableName required for zadd_bulk",
          );
        }

        const key = buildStoreKey(ctx.userId, workflowId, input.variableName);

        let items: any[] = [];

        if (Array.isArray(input.items)) {
          items = input.items;
        } else if (typeof input.items === "string") {
          try {
            const parsed = JSON.parse(input.items);
            if (Array.isArray(parsed)) {
              items = parsed;
            }
          } catch (err) {
            throw new Error("items must be a valid JSON array");
          }
        }

        if (items.length === 0) {
          throw new Error("items array required for zadd_bulk");
        }

        const scoreField = input.score || "T";
        const CHUNK_SIZE = input.chunkSize || 2000;

        for (let i = 0; i < items.length; i += CHUNK_SIZE) {
          const chunk = items.slice(i, i + CHUNK_SIZE);
          const pipeline = ctx.redis!.pipeline();

          for (const item of chunk) {
            const score = Date.parse(item[scoreField]);
            //const score = Number(item[scoreField]);
            if (Number.isNaN(score)) continue;

            pipeline.zadd(key, score, JSON.stringify(item));
          }

          await pipeline.exec();
        }

        await applyTTL(ctx.redis!, key, input.ttl);

        return {
          operation: "zadd_bulk",
          variableName: input.variableName,
          count: items.length,
          message: `Bulk inserted ${items.length} items`,
        };
      },
    },

    xadd: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const workflowId =
          input.workflow_id || input.workflowId || ctx.workflowId;
        if (!workflowId || !input.variableName || !input.value) {
          throw new Error(
            "workflow_id, variableName, and value required for xadd",
          );
        }

        const key = buildStoreKey(ctx.userId, workflowId, input.variableName);

        const item =
          typeof input.value === "string"
            ? JSON.parse(input.value)
            : input.value;

        const maxLen = Number(input.maxLen) || 50000;

        if (maxLen > 0) {
          await ctx.redis!.xadd(
            key,
            "MAXLEN",
            "~",
            maxLen,
            "*",
            "data",
            JSON.stringify(item),
          );
        } else {
          await ctx.redis!.xadd(key, "*", "data", JSON.stringify(item));
        }

        if (input.ttl && input.ttl > 0) {
          await ctx.redis!.expire(key, input.ttl);
        }

        return {
          operation: "xadd",
          variableName: input.variableName,
          message: "Stream entry added",
        };
      },
    },
    xadd_bulk: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const workflowId =
          input.workflow_id || input.workflowId || ctx.workflowId;
        if (!workflowId || !input.variableName) {
          throw new Error(
            "workflow_id and variableName required for xadd_bulk",
          );
        }

        const key = buildStoreKey(ctx.userId, workflowId, input.variableName);

        // Parse items (string or array)
        let items: any[] = [];
        if (Array.isArray(input.items)) {
          items = input.items;
        } else if (typeof input.items === "string") {
          try {
            const parsed = JSON.parse(input.items);
            if (Array.isArray(parsed)) items = parsed;
          } catch {
            throw new Error("items must be a valid JSON array");
          }
        }

        if (items.length === 0) {
          throw new Error("No items to insert into stream");
        }

        const CHUNK_SIZE = input.chunkSize || 2000;
        const maxLen = Number(input.maxLen) || 50000;

        for (let i = 0; i < items.length; i += CHUNK_SIZE) {
          const pipeline = ctx.redis!.pipeline();
          const chunk = items.slice(i, i + CHUNK_SIZE);

          for (const item of chunk) {
            if (maxLen > 0) {
              pipeline.xadd(
                key,
                "MAXLEN",
                "~",
                maxLen,
                "*",
                "data",
                JSON.stringify(item),
              );
            } else {
              pipeline.xadd(key, "*", "data", JSON.stringify(item));
            }
          }

          await pipeline.exec();
        }

        await applyTTL(ctx.redis!, key, input.ttl);

        return {
          operation: "xadd_bulk",
          variableName: input.variableName,
          count: items.length,
          message: `Bulk inserted ${items.length} stream entries`,
        };
      },
    },

    xrange: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = input.variableName || "";
        const workflowId =
          input.workflow_id || input.workflowId || ctx.workflowId;
        if (!workflowId || !input.variableName) {
          throw new Error(
            "workflow_id and variableName required for xadd_bulk",
          );
        }

        const key = buildStoreKey(ctx.userId, workflowId, varName);

        const start = input.startId || "-";
        const end = input.endId || "+";
        const count = input.count;

        const entries = count
          ? await ctx.redis!.xrange(key, start, end, "COUNT", count)
          : await ctx.redis!.xrange(key, start, end);

        return {
          operation: "xrange",
          variableName: varName,
          value: parseStreamEntries(entries),
        };
      },
    },
    xrevrange: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);

        if (!targetWorkflowId || !varName) {
          throw new Error(
            "workflow_id and variableName required for xrevrange",
          );
        }

        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const count = input.count || 100;

        const entries = await ctx.redis!.xrevrange(
          key,
          "+",
          "-",
          "COUNT",
          count,
        );

        return {
          operation: "xrevrange",
          variableName: varName,
          value: entries.reverse(), // restore order
        };
      },
    },
    xread: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);

        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for xread");
        }

        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const lastId = input.lastId || "$";
        const blockMs = input.blockMs ?? 0;

        const result = await ctx.redis!.xread(
          "BLOCK",
          blockMs,
          "STREAMS",
          key,
          lastId,
        );

        if (!result) {
          return {
            operation: "xread",
            variableName: varName,
            value: [],
            lastId,
          };
        }

        const [, entries] = result[0];

        return {
          operation: "xread",
          variableName: varName,
          value: entries,
          lastId,
        };
      },
    },

    // ============ UTILITY OPERATIONS ============
    keys: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const workflowId =
          input.workflow_id || input.workflowId || ctx.workflowId;
        const keyPattern = input.pattern || "*";
        const keyPrefix = buildStoreKey(ctx.userId, workflowId || "", "");
        const fullPattern = keyPrefix + keyPattern;
        const matchedKeys = await ctx.redis!.keys(fullPattern);
        return {
          operation: "keys",
          pattern: keyPattern,
          value: matchedKeys.map(extractVariableNameFromKey),
        };
      },
    },

    list: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const workflowId =
          input.workflow_id || input.workflowId || ctx.workflowId;
        if (!workflowId) {
          throw new Error("workflow_id required for list");
        }
        const pattern = buildStoreKey(ctx.userId, workflowId, "*");
        const keys = await ctx.redis!.keys(pattern);
        return {
          operation: "list",
          variables: keys.map(extractVariableNameFromKey),
        };
      },
    },

    exists: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for exists");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const existsResult = await ctx.redis!.exists(key);
        return {
          operation: "exists",
          variableName: varName,
          value: existsResult === 1,
        };
      },
    },

    expire: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName || !input.ttl) {
          throw new Error(
            "workflow_id, variableName, and ttl required for expire",
          );
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        await ctx.redis!.expire(key, input.ttl);
        return {
          operation: "expire",
          variableName: varName,
          message: `TTL set to ${input.ttl} seconds`,
        };
      },
    },

    ttl: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const varName = getVarName(input);
        const targetWorkflowId = getTargetWorkflowId(input, ctx);
        if (!targetWorkflowId || !varName) {
          throw new Error("workflow_id and variableName required for ttl");
        }
        const key = buildStoreKey(ctx.userId, targetWorkflowId, varName);
        const ttlValue = await ctx.redis!.ttl(key);
        return { operation: "ttl", variableName: varName, value: ttlValue };
      },
    },
  },
};

export default storeConfig;
