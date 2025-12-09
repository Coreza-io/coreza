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

import express from "express";
import { requireAuth } from "../middleware/jwtAuth";
import { getRedisCache } from "../config/redis";
import { supabase } from "../config/supabase";
import logger from "../utils/logger";
import {
  buildStoreKey,
  extractVariableNameFromKey,
  getStoreValue,
  parseStoredValue,
  setStoreValue,
  parseMembers,
  parseScoreMembers,
} from "../utils/store";

const router = express.Router();

// Apply JWT auth to all routes
router.use(requireAuth);

// GET /store/workflows - List workflows for the authenticated user
router.get("/workflows", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { data, error } = await supabase
      .from("workflows")
      .select("id, name")
      .eq("user_id", userId)
      .order("name", { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      workflows:
        data?.map((workflow) => ({ id: workflow.id, name: workflow.name })) ??
        [],
    });
  } catch (error) {
    logger.error({ err: error }, "Error listing workflows");
    res.status(500).json({ error: "Failed to list workflows" });
  }
});

// GET /store/variables - List stored variable names for a workflow
router.get("/variables", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflow_id } = req.query;

    if (!workflow_id) {
      return res
        .status(400)
        .json({ error: "workflow_id is required" });
    }

    const redis = getRedisCache();
    const pattern = buildStoreKey(
      userId,
      workflow_id as string,
      "*"
    );
    const keys = await redis.keys(pattern);

    res.json({
      success: true,
      variables: keys.map(extractVariableNameFromKey),
    });
  } catch (error) {
    logger.error({ err: error }, "Error listing variables");
    res.status(500).json({ error: "Failed to list variables" });
  }
});

// GET /store/value - Retrieve a value from another workflow
router.get("/value", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflow_id, variable_name } = req.query;

    if (!workflow_id || !variable_name) {
      return res
        .status(400)
        .json({ error: "workflow_id and variable_name required" });
    }

    const redis = getRedisCache();
    const key = buildStoreKey(
      userId,
      workflow_id as string,
      variable_name as string
    );
    const storedValue = await getStoreValue(redis, key);

    res.json({
      success: true,
      value: storedValue,
    });
  } catch (error) {
    logger.error({ err: error }, "Error fetching store value");
    res.status(500).json({ error: "Failed to fetch value" });
  }
});

// POST /store/execute - Execute comprehensive store operations
router.post("/execute", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      workflow_id,
      dataType,
      operation,
      variableName,
      variableNameManual,
      variableNameSelect,
      variableSource,
      sourceWorkflowId,
      value,
      hashField,
      members,
      member,
      score,
      scoreMembers,
      startIndex,
      endIndex,
      index,
      incrementBy,
      minScore,
      maxScore,
      pattern,
      otherKeys,
      withScores,
      reverseOrder,
      ttl,
    } = req.body;

    const redis = getRedisCache();

    // Determine variable name: manual entry, dropdown select, or write operation
    const varName = variableNameManual || variableNameSelect || variableName;

    // Determine workflow: for manual source, use current workflow; for store source, use selected workflow
    const targetWorkflowId =
      variableSource === "store" && sourceWorkflowId
        ? sourceWorkflowId
        : workflow_id;

    // Helper to apply TTL
    const applyTTL = async (key: string) => {
      if (ttl && ttl > 0) {
        await redis.expire(key, ttl);
      }
    };

    // ============ STRING OPERATIONS ============
    if (operation === "set") {
      if (!workflow_id || !variableName) {
        return res
          .status(400)
          .json({ error: "workflow_id and variableName required for set" });
      }
      const key = buildStoreKey(userId, workflow_id, variableName);
      await setStoreValue(redis, key, value, ttl);

      return res.json({
        success: true,
        data: { operation: operation, variableName, message: "Value saved" },
      });
    }

    if (operation === "get") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const storedValue = await getStoreValue(redis, key);
      return res.json({
        success: true,
        data: {
          operation: operation,
          variableName: varName,
          value: storedValue,
        },
      });
    }

    if (operation === "delete") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      await redis.del(key);
      return res.json({
        success: true,
        data: {
          operation: operation,
          variableName: varName,
          message: "Key deleted",
        },
      });
    }

    if (operation === "increment") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const amount = incrementBy || 1;
      const newValue = await redis.incrby(key, amount);
      return res.json({
        success: true,
        data: { operation: operation, variableName: varName, value: newValue },
      });
    }

    if (operation === "append") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      await redis.append(key, value || "");
      return res.json({
        success: true,
        data: {
          operation: operation,
          variableName: varName,
          message: "Value appended",
        },
      });
    }

    // ============ LIST OPERATIONS ============
    if (operation === "lpush") {
      if (!workflow_id || !variableName) {
        return res
          .status(400)
          .json({ error: "workflow_id and variableName required" });
      }
      const key = buildStoreKey(userId, workflow_id, variableName);
      const serialized =
        typeof value === "string" ? value : JSON.stringify(value);
      await redis.lpush(key, serialized);
      await applyTTL(key);
      return res.json({
        success: true,
        data: {
          operation: operation,
          variableName,
          message: "Value pushed left",
        },
      });
    }

    if (operation === "rpush") {
      if (!workflow_id || !variableName) {
        return res
          .status(400)
          .json({ error: "workflow_id and variableName required" });
      }
      const key = buildStoreKey(userId, workflow_id, variableName);
      const serialized =
        typeof value === "string" ? value : JSON.stringify(value);
      await redis.rpush(key, serialized);
      await applyTTL(key);
      return res.json({
        success: true,
        data: {
          operation: operation,
          variableName,
          message: "Value pushed right",
        },
      });
    }

    if (operation === "lpop") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const popped = await redis.lpop(key);
      return res.json({
        success: true,
        data: {
          operation: operation,
          variableName: varName,
          value: parseStoredValue(popped),
        },
      });
    }

    if (operation === "rpop") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const popped = await redis.rpop(key);
      return res.json({
        success: true,
        data: {
          operation: operation,
          variableName: varName,
          value: parseStoredValue(popped),
        },
      });
    }

    if (operation === "lrange") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const start = startIndex ?? 0;
      const end = endIndex ?? -1;
      const items = await redis.lrange(key, start, end);
      return res.json({
        success: true,
        data: {
          operation: operation,
          variableName: varName,
          value: items.map(parseStoredValue),
        },
      });
    }

    if (operation === "llen") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const length = await redis.llen(key);
      return res.json({
        success: true,
        data: { operation: operation, variableName: varName, value: length },
      });
    }

    if (operation === "lindex") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const item = await redis.lindex(key, index ?? 0);
      return res.json({
        success: true,
        data: {
          operation: operation,
          variableName: varName,
          value: parseStoredValue(item),
        },
      });
    }

    if (operation === "lset") {
      if (!workflow_id || !variableName) {
        return res
          .status(400)
          .json({ error: "workflow_id and variableName required" });
      }
      const key = buildStoreKey(userId, workflow_id, variableName);
      const serialized =
        typeof value === "string" ? value : JSON.stringify(value);
      await redis.lset(key, index ?? 0, serialized);
      return res.json({
        success: true,
        data: {
          operation: operation,
          variableName,
          message: "Value set at index",
        },
      });
    }

    if (operation === "ltrim") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const start = startIndex ?? 0;
      const end = endIndex ?? -1;
      await redis.ltrim(key, start, end);
      return res.json({
        success: true,
        data: {
          operation: "ltrim",
          variableName: varName,
          message: "List trimmed",
        },
      });
    }

    // ============ HASH OPERATIONS ============
    if (operation === "hset") {
      if (!workflow_id || !variableName || !hashField) {
        return res
          .status(400)
          .json({ error: "workflow_id, variableName, and hashField required" });
      }
      const key = buildStoreKey(userId, workflow_id, variableName);
      const serialized =
        typeof value === "string" ? value : JSON.stringify(value);
      await redis.hset(key, hashField, serialized);
      await applyTTL(key);
      return res.json({
        success: true,
        data: {
          operation: "hset",
          variableName,
          hashField,
          message: "Hash field set",
        },
      });
    }

    if (operation === "hget") {
      if (!targetWorkflowId || !varName || !hashField) {
        return res
          .status(400)
          .json({
            error:
              "sourceWorkflowId, variableNameSelect, and hashField required",
          });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const fieldValue = await redis.hget(key, hashField);
      return res.json({
        success: true,
        data: {
          operation: "hget",
          variableName: varName,
          hashField,
          value: parseStoredValue(fieldValue),
        },
      });
    }

    if (operation === "hgetall") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const hash = await redis.hgetall(key);
      const parsed: Record<string, any> = {};
      for (const [field, val] of Object.entries(hash)) {
        parsed[field] = parseStoredValue(val);
      }
      return res.json({
        success: true,
        data: { operation: "hgetall", variableName: varName, value: parsed },
      });
    }

    if (operation === "hdel") {
      if (!targetWorkflowId || !varName || !hashField) {
        return res
          .status(400)
          .json({
            error:
              "sourceWorkflowId, variableNameSelect, and hashField required",
          });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      await redis.hdel(key, hashField);
      return res.json({
        success: true,
        data: {
          operation: "hdel",
          variableName: varName,
          hashField,
          message: "Hash field deleted",
        },
      });
    }

    if (operation === "hkeys") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const keys = await redis.hkeys(key);
      return res.json({
        success: true,
        data: { operation: "hkeys", variableName: varName, value: keys },
      });
    }

    if (operation === "hvals") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const vals = await redis.hvals(key);
      return res.json({
        success: true,
        data: {
          operation: "hvals",
          variableName: varName,
          value: vals.map(parseStoredValue),
        },
      });
    }

    if (operation === "hexists") {
      if (!targetWorkflowId || !varName || !hashField) {
        return res
          .status(400)
          .json({
            error:
              "sourceWorkflowId, variableNameSelect, and hashField required",
          });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const exists = await redis.hexists(key, hashField);
      return res.json({
        success: true,
        data: {
          operation: "hexists",
          variableName: varName,
          hashField,
          value: exists === 1,
        },
      });
    }

    if (operation === "hincrby") {
      if (!targetWorkflowId || !varName || !hashField) {
        return res
          .status(400)
          .json({
            error:
              "sourceWorkflowId, variableNameSelect, and hashField required",
          });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const amount = incrementBy || 1;
      const newValue = await redis.hincrby(key, hashField, amount);
      return res.json({
        success: true,
        data: {
          operation: "hincrby",
          variableName: varName,
          hashField,
          value: newValue,
        },
      });
    }

    // ============ SET OPERATIONS ============
    if (operation === "sadd") {
      if (!workflow_id || !variableName) {
        return res
          .status(400)
          .json({ error: "workflow_id and variableName required" });
      }
      const key = buildStoreKey(userId, workflow_id, variableName);
      const memberList = parseMembers(members);
      if (memberList.length === 0) {
        return res.status(400).json({ error: "members required for sadd" });
      }
      await redis.sadd(key, ...memberList);
      await applyTTL(key);
      return res.json({
        success: true,
        data: {
          operation: "sadd",
          variableName,
          message: `Added ${memberList.length} member(s)`,
        },
      });
    }

    if (operation === "srem") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const memberList = parseMembers(members);
      if (memberList.length === 0) {
        return res.status(400).json({ error: "members required for srem" });
      }
      await redis.srem(key, ...memberList);
      return res.json({
        success: true,
        data: {
          operation: "srem",
          variableName: varName,
          message: `Removed ${memberList.length} member(s)`,
        },
      });
    }

    if (operation === "smembers") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const setMembers = await redis.smembers(key);
      return res.json({
        success: true,
        data: {
          operation: "smembers",
          variableName: varName,
          value: setMembers.map(parseStoredValue),
        },
      });
    }

    if (operation === "sismember") {
      if (!targetWorkflowId || !varName || !member) {
        return res
          .status(400)
          .json({
            error: "sourceWorkflowId, variableNameSelect, and member required",
          });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const isMember = await redis.sismember(key, member);
      return res.json({
        success: true,
        data: {
          operation: "sismember",
          variableName: varName,
          member,
          value: isMember === 1,
        },
      });
    }

    if (operation === "scard") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const count = await redis.scard(key);
      return res.json({
        success: true,
        data: { operation: "scard", variableName: varName, value: count },
      });
    }

    if (operation === "sinter" || operation === "sunion" || operation === "sdiff") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const otherKeysList = Array.isArray(otherKeys) ? otherKeys : [];
      const allKeys = [key, ...otherKeysList.map((k: string) => buildStoreKey(userId, targetWorkflowId, k))];
      
      let result: string[];
      if (operation === "sinter") {
        result = await redis.sinter(...allKeys);
      } else if (operation === "sunion") {
        result = await redis.sunion(...allKeys);
      } else {
        result = await redis.sdiff(...allKeys);
      }
      
      return res.json({
        success: true,
        data: {
          operation,
          variableName: varName,
          value: result.map(parseStoredValue),
        },
      });
    }

    // ============ SORTED SET OPERATIONS ============
    if (operation === "zadd") {
      if (!workflow_id || !variableName) {
        return res
          .status(400)
          .json({ error: "workflow_id and variableName required" });
      }
      const key = buildStoreKey(userId, workflow_id, variableName);
      const scoreMembersList = parseScoreMembers(scoreMembers);
      if (scoreMembersList.length === 0) {
        return res.status(400).json({ error: "scoreMembers required for zadd" });
      }
      await redis.zadd(key, ...scoreMembersList);
      await applyTTL(key);
      return res.json({
        success: true,
        data: {
          operation: "zadd",
          variableName,
          message: `Added ${scoreMembersList.length / 2} member(s)`,
        },
      });
    }

    if (operation === "zrange") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const start = startIndex ?? 0;
      const end = endIndex ?? -1;
      
      let result: string[];
      if (reverseOrder) {
        result = withScores
          ? await redis.zrevrange(key, start, end, "WITHSCORES")
          : await redis.zrevrange(key, start, end);
      } else {
        result = withScores
          ? await redis.zrange(key, start, end, "WITHSCORES")
          : await redis.zrange(key, start, end);
      }
      
      return res.json({
        success: true,
        data: {
          operation: "zrange",
          variableName: varName,
          value: result.map(parseStoredValue),
        },
      });
    }

    if (operation === "zscore") {
      if (!targetWorkflowId || !varName || !member) {
        return res
          .status(400)
          .json({
            error: "sourceWorkflowId, variableNameSelect, and member required",
          });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const scoreVal = await redis.zscore(key, member);
      return res.json({
        success: true,
        data: {
          operation: "zscore",
          variableName: varName,
          member,
          value: scoreVal ? parseFloat(scoreVal) : null,
        },
      });
    }

    if (operation === "zcount") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const min = minScore ?? "-inf";
      const max = maxScore ?? "+inf";
      const count = await redis.zcount(key, min, max);
      return res.json({
        success: true,
        data: { operation: "zcount", variableName: varName, value: count },
      });
    }

    if (operation === "zincrby") {
      if (!targetWorkflowId || !varName || !member) {
        return res
          .status(400)
          .json({
            error: "sourceWorkflowId, variableNameSelect, and member required",
          });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const amount = incrementBy || 1;
      const newScore = await redis.zincrby(key, amount, member);
      return res.json({
        success: true,
        data: {
          operation: "zincrby",
          variableName: varName,
          member,
          value: parseFloat(newScore),
        },
      });
    }

    if (operation === "zrem") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const memberList = parseMembers(members);
      if (memberList.length === 0) {
        return res.status(400).json({ error: "members required for zrem" });
      }
      await redis.zrem(key, ...memberList);
      return res.json({
        success: true,
        data: {
          operation: "zrem",
          variableName: varName,
          message: `Removed ${memberList.length} member(s)`,
        },
      });
    }

    // ============ UTILITY OPERATIONS ============
    if (operation === "keys") {
      const keyPattern = pattern || "*";
      const keyPrefix = buildStoreKey(userId, targetWorkflowId || workflow_id || "", "");
      const fullPattern = keyPrefix + keyPattern;
      const matchedKeys = await redis.keys(fullPattern);
      return res.json({
        success: true,
        data: {
          operation: "keys",
          pattern: keyPattern,
          value: matchedKeys.map(extractVariableNameFromKey),
        },
      });
    }

    if (operation === "exists") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const existsResult = await redis.exists(key);
      return res.json({
        success: true,
        data: {
          operation: "exists",
          variableName: varName,
          value: existsResult === 1,
        },
      });
    }

    if (operation === "expire") {
      if (!targetWorkflowId || !varName || !ttl) {
        return res
          .status(400)
          .json({
            error: "sourceWorkflowId, variableNameSelect, and ttl required",
          });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      await redis.expire(key, ttl);
      return res.json({
        success: true,
        data: {
          operation: "expire",
          variableName: varName,
          message: `TTL set to ${ttl} seconds`,
        },
      });
    }

    if (operation === "ttl") {
      if (!targetWorkflowId || !varName) {
        return res
          .status(400)
          .json({ error: "sourceWorkflowId and variableNameSelect required" });
      }
      const key = buildStoreKey(userId, targetWorkflowId, varName);
      const ttlValue = await redis.ttl(key);
      return res.json({
        success: true,
        data: { operation: "ttl", variableName: varName, value: ttlValue },
      });
    }

    return res.status(400).json({ error: `Unknown operation: ${operation}` });
  } catch (error) {
    logger.error({ err: error }, "Error executing store operation");
    res.status(500).json({ error: "Failed to execute store operation" });
  }
});

export default router;
