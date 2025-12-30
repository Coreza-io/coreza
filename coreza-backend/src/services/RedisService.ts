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

import Redis from "ioredis";
import logger from "../utils/logger";
import CredentialManager from "../utils/credentialManager";
import { createSuccessOutput, createErrorOutput } from "../utils/normalizeOutput";
import type { StandardNodeOutput } from "../types/nodeOutput";

// Cache for user Redis connections
const userRedisConnections = new Map<string, Redis>();

interface RedisOperationParams {
  operation: string;
  scope?: string;
  key?: string;
  value?: any;
  keyType?: string;
  pattern?: string;
  channel?: string;
  hashField?: string;
  setMember?: string;
  popDirection?: string;
  pushDirection?: string;
  members?: string | string[];
  member?: string;
  otherKeys?: string | string[];
  incrementBy?: number;
  startIndex?: number;
  endIndex?: number;
  index?: number;
  ttl?: number;
  score?: number;
  scoreMembers?: string | Array<{ score: number; member: string }>;
  withScores?: string;
  reverseOrder?: string;
  minScore?: string;
  maxScore?: string;
  channelPattern?: string;
  channels?: string;
  userId: string;
  credentialId: string;
  workflowId?: string;
}

const REDIS_CONTEXT = { nodeName: 'Redis', category: 'data' };

// Helper to get or create user's Redis connection
async function getUserRedis(
  userId: string,
  credentialId: string
): Promise<Redis> {
  const cacheKey = `${userId}:${credentialId}`;

  if (userRedisConnections.has(cacheKey)) {
    const redis = userRedisConnections.get(cacheKey)!;
    if (redis.status === "ready" || redis.status === "connecting") {
      return redis;
    }
    userRedisConnections.delete(cacheKey);
  }

  const { credentials } = await CredentialManager.getCredentials(
    userId,
    "redis",
    credentialId
  );
  const creds = credentials?.client_json;

  if (!creds?.host) {
    throw new Error("Invalid Redis credentials");
  }

  const redis = new Redis({
    host: creds.host,
    port: parseInt(creds.port || "6379", 10),
    password: creds.password || undefined,
    username: creds.user || undefined,
    db: parseInt(creds.database || "0", 10),
    tls: creds.tls === "true" ? { rejectUnauthorized: false } : undefined,
    maxRetriesPerRequest: 3,
    connectTimeout: 10000,
    lazyConnect: false,
  });

  await new Promise((resolve, reject) => {
    redis.once("ready", resolve);
    redis.once("error", reject);
    setTimeout(() => reject(new Error("Redis connection timeout")), 10000);
  });

  userRedisConnections.set(cacheKey, redis);
  logger.info(
    { userId, credentialId, host: creds.host },
    "User Redis connection established"
  );
  return redis;
}

export class RedisService {
  private static buildKey(
    scope: string,
    key: string,
    context: { userId?: string; workflowId?: string }
  ): string {
    switch (scope) {
      case "global":
        return `global:${key}`;
      case "user":
        return `user:${context.userId}:${key}`;
      case "workflow":
      default:
        return `workflow:${context.workflowId}:${key}`;
    }
  }

  private static async detectKeyType(
    redis: Redis,
    key: string,
    value: any
  ): Promise<string> {
    const existingType = await redis.type(key);
    if (existingType !== "none") {
      return existingType;
    }

    if (Array.isArray(value)) {
      return "list";
    } else if (typeof value === "object" && value !== null) {
      return "hash";
    } else {
      return "string";
    }
  }

  static async execute(params: RedisOperationParams): Promise<StandardNodeOutput> {
    try {
      const redis = await getUserRedis(params.userId, params.credentialId);
      const {
        operation,
        key: rawKey,
        value,
        ttl,
        scope,
        keyType = "automatic",
      } = params;

      const key = ["info", "keys"].includes(operation)
        ? rawKey
        : this.buildKey(scope || "workflow", rawKey || "", {
            userId: params.userId,
            workflowId: params.workflowId,
          });

      switch (operation) {
        case "set": {
          const actualKeyType =
            keyType === "automatic"
              ? await this.detectKeyType(redis, key, value)
              : keyType;

          if (actualKeyType === "hash") {
            const { hashField } = params;
            if (!hashField) {
              return createErrorOutput("Hash field is required for hash type", REDIS_CONTEXT);
            }
            const serialized =
              typeof value === "object" ? JSON.stringify(value) : String(value);
            await redis.hset(key, hashField, serialized);
          } else if (actualKeyType === "list") {
            const serialized =
              typeof value === "object" ? JSON.stringify(value) : String(value);
            await redis.rpush(key, serialized);
          } else if (actualKeyType === "sets") {
            const { setMember } = params;
            if (!setMember) {
              return createErrorOutput("Set member is required for sets type", REDIS_CONTEXT);
            }
            await redis.sadd(key, setMember);
          } else {
            const serialized =
              typeof value === "object" ? JSON.stringify(value) : String(value);
            await redis.set(key, serialized);
          }

          if (ttl && ttl > 0) {
            await redis.expire(key, ttl);
          }
          return createSuccessOutput({
            message: "Value set successfully",
            key,
            keyType: actualKeyType,
          }, REDIS_CONTEXT);
        }

        case "get": {
          const actualKeyType =
            keyType === "automatic" ? await redis.type(key) : keyType;

          if (actualKeyType === "hash") {
            const { hashField } = params;
            if (hashField) {
              const result = await redis.hget(key, hashField);
              if (!result) {
                return createErrorOutput("Hash field not found", REDIS_CONTEXT);
              }
              try {
                return createSuccessOutput({ value: JSON.parse(result), key, hashField }, REDIS_CONTEXT);
              } catch {
                return createSuccessOutput({ value: result, key, hashField }, REDIS_CONTEXT);
              }
            } else {
              const result = await redis.hgetall(key);
              if (!result || Object.keys(result).length === 0) {
                return createErrorOutput("Hash not found or empty", REDIS_CONTEXT);
              }
              const parsed: Record<string, any> = {};
              for (const [k, v] of Object.entries(result)) {
                try {
                  parsed[k] = JSON.parse(v);
                } catch {
                  parsed[k] = v;
                }
              }
              return createSuccessOutput({ value: parsed, key }, REDIS_CONTEXT);
            }
          } else if (actualKeyType === "list") {
            const results = await redis.lrange(key, 0, -1);
            const parsed = results.map((item) => {
              try {
                return JSON.parse(item);
              } catch {
                return item;
              }
            });
            return createSuccessOutput({ values: parsed, count: parsed.length, key }, REDIS_CONTEXT);
          } else if (actualKeyType === "set") {
            const members = await redis.smembers(key);
            return createSuccessOutput({ values: members, count: members.length, key }, REDIS_CONTEXT);
          } else {
            const result = await redis.get(key);
            if (!result) {
              return createErrorOutput("Key not found", REDIS_CONTEXT);
            }
            try {
              return createSuccessOutput({ value: JSON.parse(result), key }, REDIS_CONTEXT);
            } catch {
              return createSuccessOutput({ value: result, key }, REDIS_CONTEXT);
            }
          }
        }

        case "delete": {
          const actualKeyType =
            keyType === "automatic" ? await redis.type(key) : keyType;

          if (actualKeyType === "hash") {
            const { hashField } = params;
            if (hashField) {
              const deleted = await redis.hdel(key, hashField);
              return createSuccessOutput({
                message: deleted > 0 ? "Hash field deleted" : "Hash field not found",
                key,
                hashField,
              }, REDIS_CONTEXT);
            }
          } else if (actualKeyType === "sets") {
            const { setMember } = params;
            if (setMember) {
              const deleted = await redis.srem(key, setMember);
              return createSuccessOutput({
                message: deleted > 0 ? "Set member deleted" : "Set member not found",
                key,
                setMember,
              }, REDIS_CONTEXT);
            }
          }

          const deleted = await redis.del(key);
          return createSuccessOutput({
            message: deleted > 0 ? "Key deleted" : "Key not found",
            key,
          }, REDIS_CONTEXT);
        }

        case "increment": {
          const newValue = await redis.incr(key);
          return createSuccessOutput({ value: newValue, key }, REDIS_CONTEXT);
        }

        case "info": {
          const info = await redis.info();
          const sections: Record<string, any> = {};
          let currentSection = "default";

          info.split("\r\n").forEach((line) => {
            if (line.startsWith("#")) {
              currentSection = line.substring(2).trim();
              sections[currentSection] = {};
            } else if (line.includes(":")) {
              const [k, v] = line.split(":");
              if (!sections[currentSection]) sections[currentSection] = {};
              sections[currentSection][k] = isNaN(Number(v))
                ? v
                : Number(v);
            }
          });

          return createSuccessOutput({ info: sections }, REDIS_CONTEXT);
        }

        case "keys": {
          const { pattern = "*" } = params;
          const keys = await redis.keys(pattern);
          return createSuccessOutput({ keys, count: keys.length, pattern }, REDIS_CONTEXT);
        }

        case "pop": {
          const { popDirection = "left" } = params;
          const result =
            popDirection === "left"
              ? await redis.lpop(key)
              : await redis.rpop(key);

          if (!result) {
            return createErrorOutput("List is empty or key not found", REDIS_CONTEXT);
          }

          try {
            return createSuccessOutput({ value: JSON.parse(result), key }, REDIS_CONTEXT);
          } catch {
            return createSuccessOutput({ value: result, key }, REDIS_CONTEXT);
          }
        }

        case "publish": {
          const { channel } = params;
          if (!channel) {
            return createErrorOutput("Channel is required for publish operation", REDIS_CONTEXT);
          }

          const serialized =
            typeof value === "object" ? JSON.stringify(value) : String(value);
          const subscribers = await redis.publish(channel, serialized);

          return createSuccessOutput({
            message: `Message published to ${subscribers} subscriber(s)`,
            channel,
            subscribers,
          }, REDIS_CONTEXT);
        }

        case "push": {
          const { pushDirection = "left" } = params;
          const serialized =
            typeof value === "object" ? JSON.stringify(value) : String(value);
          const length =
            pushDirection === "left"
              ? await redis.lpush(key, serialized)
              : await redis.rpush(key, serialized);

          if (ttl && ttl > 0) {
            await redis.expire(key, ttl);
          }

          return createSuccessOutput({
            message: `Value pushed to ${pushDirection} of list`,
            length,
            key,
          }, REDIS_CONTEXT);
        }

        case "sadd": {
          const membersArray = this.parseMembers(params.members);
          if (membersArray.length === 0) {
            return createErrorOutput("At least one member is required", REDIS_CONTEXT);
          }
          const added = await redis.sadd(key, ...membersArray);
          if (ttl && ttl > 0) {
            await redis.expire(key, ttl);
          }
          return createSuccessOutput({
            added,
            members: membersArray,
            key,
            message: `${added} member(s) added to set`,
          }, REDIS_CONTEXT);
        }

        case "srem": {
          const membersArray = this.parseMembers(params.members);
          if (membersArray.length === 0) {
            return createErrorOutput("At least one member is required", REDIS_CONTEXT);
          }
          const removed = await redis.srem(key, ...membersArray);
          return createSuccessOutput({
            removed,
            members: membersArray,
            key,
            message: `${removed} member(s) removed from set`,
          }, REDIS_CONTEXT);
        }

        case "smembers": {
          const members = await redis.smembers(key);
          return createSuccessOutput({
            members,
            count: members.length,
            key,
          }, REDIS_CONTEXT);
        }

        case "sismember": {
          const { member } = params;
          if (!member) {
            return createErrorOutput("Member is required for SISMEMBER", REDIS_CONTEXT);
          }
          const isMember = await redis.sismember(key, member);
          return createSuccessOutput({
            isMember: isMember === 1,
            member,
            key,
          }, REDIS_CONTEXT);
        }

        case "scard": {
          const count = await redis.scard(key);
          return createSuccessOutput({ count, key }, REDIS_CONTEXT);
        }

        case "sinter": {
          const otherKeysArray = this.parseOtherKeys(
            params.otherKeys,
            scope || "workflow",
            params
          );
          const allKeys = [key, ...otherKeysArray];
          const intersection = await redis.sinter(...allKeys);
          return createSuccessOutput({
            members: intersection,
            count: intersection.length,
            keys: allKeys,
          }, REDIS_CONTEXT);
        }

        case "sunion": {
          const otherKeysArray = this.parseOtherKeys(
            params.otherKeys,
            scope || "workflow",
            params
          );
          const allKeys = [key, ...otherKeysArray];
          const union = await redis.sunion(...allKeys);
          return createSuccessOutput({
            members: union,
            count: union.length,
            keys: allKeys,
          }, REDIS_CONTEXT);
        }

        case "sdiff": {
          const otherKeysArray = this.parseOtherKeys(
            params.otherKeys,
            scope || "workflow",
            params
          );
          const allKeys = [key, ...otherKeysArray];
          const diff = await redis.sdiff(...allKeys);
          return createSuccessOutput({
            members: diff,
            count: diff.length,
            keys: allKeys,
            message: "Members in first set but not in other sets",
          }, REDIS_CONTEXT);
        }

        case "hkeys": {
          const fields = await redis.hkeys(key);
          return createSuccessOutput({
            fields,
            count: fields.length,
            key,
            message: `Found ${fields.length} field(s) in hash`,
          }, REDIS_CONTEXT);
        }

        case "hvals": {
          const values = await redis.hvals(key);
          const parsed = values.map((v) => {
            try {
              return JSON.parse(v);
            } catch {
              return v;
            }
          });
          return createSuccessOutput({
            values: parsed,
            count: parsed.length,
            key,
            message: `Found ${parsed.length} value(s) in hash`,
          }, REDIS_CONTEXT);
        }

        case "hexists": {
          const { hashField } = params;
          if (!hashField) {
            return createErrorOutput("Hash field is required for HEXISTS", REDIS_CONTEXT);
          }
          const exists = await redis.hexists(key, hashField);
          return createSuccessOutput({
            exists: exists === 1,
            field: hashField,
            key,
          }, REDIS_CONTEXT);
        }

        case "hincrby": {
          const { hashField, incrementBy = 1 } = params;
          if (!hashField) {
            return createErrorOutput("Hash field is required for HINCRBY", REDIS_CONTEXT);
          }
          const newValue = await redis.hincrby(key, hashField, incrementBy);
          return createSuccessOutput({
            value: newValue,
            field: hashField,
            incrementBy,
            key,
            message: `Field '${hashField}' incremented by ${incrementBy}, new value: ${newValue}`,
          }, REDIS_CONTEXT);
        }

        case "lrange": {
          const { startIndex = 0, endIndex = -1 } = params;
          const elements = await redis.lrange(key, startIndex, endIndex);
          const parsed = elements.map((item) => {
            try {
              return JSON.parse(item);
            } catch {
              return item;
            }
          });
          return createSuccessOutput({
            values: parsed,
            count: parsed.length,
            startIndex,
            endIndex,
            key,
            message: `Retrieved ${parsed.length} element(s) from index ${startIndex} to ${endIndex}`,
          }, REDIS_CONTEXT);
        }

        case "llen": {
          const length = await redis.llen(key);
          return createSuccessOutput({
            length,
            key,
            message: `List contains ${length} element(s)`,
          }, REDIS_CONTEXT);
        }

        case "lindex": {
          const { index } = params;
          if (index === undefined) {
            return createErrorOutput("Index is required for LINDEX", REDIS_CONTEXT);
          }
          const element = await redis.lindex(key, index);
          if (element === null) {
            return createErrorOutput("Index out of range or list not found", REDIS_CONTEXT);
          }
          try {
            return createSuccessOutput({ value: JSON.parse(element), key, index }, REDIS_CONTEXT);
          } catch {
            return createSuccessOutput({ value: element, key, index }, REDIS_CONTEXT);
          }
        }

        case "lset": {
          const { index, value: val } = params;
          if (index === undefined) {
            return createErrorOutput("Index is required for LSET", REDIS_CONTEXT);
          }
          if (val === undefined) {
            return createErrorOutput("Value is required for LSET", REDIS_CONTEXT);
          }
          const serialized =
            typeof val === "object" ? JSON.stringify(val) : String(val);
          await redis.lset(key, index, serialized);
          return createSuccessOutput({
            key,
            index,
            message: `Element at index ${index} updated successfully`,
          }, REDIS_CONTEXT);
        }

        case "ltrim": {
          const { startIndex = 0, endIndex = -1 } = params;
          await redis.ltrim(key, startIndex, endIndex);
          return createSuccessOutput({
            key,
            startIndex,
            endIndex,
            message: `List trimmed to range ${startIndex} to ${endIndex}`,
          }, REDIS_CONTEXT);
        }

        case "zadd": {
          const { score, scoreMembers, member } = params;

          // Handle batch add with score:member pairs
          if (scoreMembers) {
            const pairs = this.parseScoreMembers(scoreMembers);
            if (pairs.length === 0) {
              return createErrorOutput("Invalid score-member pairs format", REDIS_CONTEXT);
            }
            const args: (string | number)[] = [];
            pairs.forEach((p) => {
              args.push(p.score, p.member);
            });
            const added = await redis.zadd(key, ...args);
            if (ttl && ttl > 0) await redis.expire(key, ttl);
            return createSuccessOutput({
              added,
              pairs,
              key,
              message: `${added} member(s) added to sorted set`,
            }, REDIS_CONTEXT);
          }

          // Handle single member add
          if (score === undefined || !member) {
            return createErrorOutput("Score and member are required, or provide scoreMembers for batch", REDIS_CONTEXT);
          }
          const added = await redis.zadd(key, score, member);
          if (ttl && ttl > 0) await redis.expire(key, ttl);
          return createSuccessOutput({
            added,
            score,
            member,
            key,
            message: added ? "Member added" : "Member score updated",
          }, REDIS_CONTEXT);
        }

        case "zrange": {
          const {
            startIndex = 0,
            endIndex = -1,
            withScores = "true",
            reverseOrder = "false",
          } = params;
          const useRev = reverseOrder === "true";
          const includeScores = withScores === "true";

          let results: string[];
          if (useRev) {
            results = includeScores
              ? await redis.zrevrange(key, startIndex, endIndex, "WITHSCORES")
              : await redis.zrevrange(key, startIndex, endIndex);
          } else {
            results = includeScores
              ? await redis.zrange(key, startIndex, endIndex, "WITHSCORES")
              : await redis.zrange(key, startIndex, endIndex);
          }

          if (includeScores) {
            // Parse alternating member/score pairs
            const members: Array<{ member: string; score: number }> = [];
            for (let i = 0; i < results.length; i += 2) {
              members.push({
                member: results[i],
                score: parseFloat(results[i + 1]),
              });
            }
            return createSuccessOutput({
              members,
              count: members.length,
              key,
              startIndex,
              endIndex,
            }, REDIS_CONTEXT);
          }

          return createSuccessOutput({
            members: results,
            count: results.length,
            key,
            startIndex,
            endIndex,
          }, REDIS_CONTEXT);
        }

        case "zscore": {
          const { member } = params;
          if (!member) {
            return createErrorOutput("Member is required for ZSCORE", REDIS_CONTEXT);
          }
          const scoreVal = await redis.zscore(key, member);
          if (scoreVal === null) {
            return createErrorOutput("Member not found in sorted set", REDIS_CONTEXT);
          }
          return createSuccessOutput({ score: parseFloat(scoreVal), member, key }, REDIS_CONTEXT);
        }

        case "zcount": {
          const { minScore = "-inf", maxScore = "+inf" } = params;
          const count = await redis.zcount(key, minScore, maxScore);
          return createSuccessOutput({ count, minScore, maxScore, key }, REDIS_CONTEXT);
        }

        case "zincrby": {
          const { member, score } = params;
          if (!member) {
            return createErrorOutput("Member is required for ZINCRBY", REDIS_CONTEXT);
          }
          const increment = score ?? 1;
          const newScore = await redis.zincrby(key, increment, member);
          return createSuccessOutput({
            newScore: parseFloat(newScore),
            member,
            increment,
            key,
            message: `Member '${member}' score incremented by ${increment}, new score: ${newScore}`,
          }, REDIS_CONTEXT);
        }

        case "zrem": {
          const membersArray = this.parseMembers(params.members);
          if (membersArray.length === 0) {
            return createErrorOutput("At least one member is required for ZREM", REDIS_CONTEXT);
          }
          const removed = await redis.zrem(key, ...membersArray);
          return createSuccessOutput({
            removed,
            members: membersArray,
            key,
            message: `${removed} member(s) removed from sorted set`,
          }, REDIS_CONTEXT);
        }

        case "pubsub_channels": {
          const { channelPattern = "*" } = params;
          const channels = await redis.pubsub("CHANNELS", channelPattern);
          return createSuccessOutput({
            channels,
            count: channels.length,
            pattern: channelPattern,
            message: `Found ${channels.length} active channel(s)`,
          }, REDIS_CONTEXT);
        }

        case "pubsub_numsub": {
          const channelList = this.parseMembers(params.channels);
          if (channelList.length === 0) {
            return createErrorOutput("At least one channel is required", REDIS_CONTEXT);
          }
          const result = (await redis.pubsub(
            "NUMSUB",
            ...channelList
          )) as any[];
          // Result is [channel1, count1, channel2, count2, ...]
          const subscribers: Record<string, number> = {};
          for (let i = 0; i < result.length; i += 2) {
            subscribers[result[i] as string] = result[i + 1] as number;
          }
          return createSuccessOutput({
            subscribers,
            channels: channelList,
            message: `Subscriber counts for ${channelList.length} channel(s)`,
          }, REDIS_CONTEXT);
        }

        default:
          return createErrorOutput(`Unsupported operation: ${operation}`, REDIS_CONTEXT);
      }
    } catch (error: any) {
      logger.error(
        { err: error, operation: params.operation, key: params.key },
        "Redis operation failed"
      );
      return createErrorOutput(error, REDIS_CONTEXT);
    }
  }

  private static parseMembers(
    members: string | string[] | undefined
  ): string[] {
    if (!members) return [];
    if (Array.isArray(members)) return members.map(String);
    return members
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
  }

  private static parseOtherKeys(
    otherKeys: string | string[] | undefined,
    scope: string,
    params: RedisOperationParams
  ): string[] {
    if (!otherKeys) return [];
    const keys = Array.isArray(otherKeys)
      ? otherKeys
      : otherKeys
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);

    return keys.map((k) =>
      this.buildKey(scope, k, {
        userId: params.userId,
        workflowId: params.workflowId,
      })
    );
  }

  private static parseScoreMembers(
    input: string | Array<{ score: number; member: string }> | undefined
  ): Array<{ score: number; member: string }> {
    if (!input) return [];
    if (Array.isArray(input)) return input;

    // Parse "score1:member1, score2:member2" format
    return input
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [scoreStr, ...memberParts] = pair.split(":");
        const score = parseFloat(scoreStr.trim());
        const member = memberParts.join(":").trim();
        return { score, member };
      })
      .filter((p) => !isNaN(p.score) && p.member);
  }
}
