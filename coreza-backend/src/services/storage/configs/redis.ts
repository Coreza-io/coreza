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

import type { StorageConfig, StorageInput, StorageContext } from "../types";

// Helper to build scoped key
function buildKey(
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

// Helper to detect key type
async function detectKeyType(redis: any, key: string, value: any): Promise<string> {
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

// Helper to parse members
function parseMembers(members: string | string[] | undefined): string[] {
  if (!members) return [];
  if (Array.isArray(members)) return members.map(String);
  return members
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

// Helper to parse other keys
function parseOtherKeys(
  otherKeys: string | string[] | undefined,
  scope: string,
  context: { userId?: string; workflowId?: string }
): string[] {
  if (!otherKeys) return [];
  const keys = Array.isArray(otherKeys)
    ? otherKeys
    : otherKeys
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);

  return keys.map((k) => buildKey(scope, k, context));
}

// Helper to parse score-members
function parseScoreMembers(
  input: string | Array<{ score: number; member: string }> | undefined
): Array<{ score: number; member: string }> {
  if (!input) return [];
  if (Array.isArray(input)) return input;

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

export const redisConfig: StorageConfig = {
  requiresCredentials: true, // Uses user's external Redis

  operations: {
    set: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, value, ttl, scope, keyType = "automatic" } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        
        const actualKeyType = keyType === "automatic"
          ? await detectKeyType(ctx.redis!, key, value)
          : keyType;

        if (actualKeyType === "hash") {
          const { hashField } = input;
          if (!hashField) throw new Error("Hash field is required for hash type");
          const serialized = typeof value === "object" ? JSON.stringify(value) : String(value);
          await ctx.redis!.hset(key, hashField, serialized);
        } else if (actualKeyType === "list") {
          const serialized = typeof value === "object" ? JSON.stringify(value) : String(value);
          await ctx.redis!.rpush(key, serialized);
        } else if (actualKeyType === "sets") {
          const { setMember } = input;
          if (!setMember) throw new Error("Set member is required for sets type");
          await ctx.redis!.sadd(key, setMember);
        } else {
          const serialized = typeof value === "object" ? JSON.stringify(value) : String(value);
          await ctx.redis!.set(key, serialized);
        }

        if (ttl && ttl > 0) {
          await ctx.redis!.expire(key, ttl);
        }
        return { message: "Value set successfully", key, keyType: actualKeyType };
      },
    },

    get: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, keyType = "automatic" } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        
        const actualKeyType = keyType === "automatic" ? await ctx.redis!.type(key) : keyType;

        if (actualKeyType === "hash") {
          const { hashField } = input;
          if (hashField) {
            const result = await ctx.redis!.hget(key, hashField);
            if (!result) throw new Error("Hash field not found");
            try {
              return { value: JSON.parse(result), key, hashField };
            } catch {
              return { value: result, key, hashField };
            }
          } else {
            const result = await ctx.redis!.hgetall(key);
            if (!result || Object.keys(result).length === 0) {
              throw new Error("Hash not found or empty");
            }
            const parsed: Record<string, any> = {};
            for (const [k, v] of Object.entries(result)) {
              try {
                parsed[k] = JSON.parse(v);
              } catch {
                parsed[k] = v;
              }
            }
            return { value: parsed, key };
          }
        } else if (actualKeyType === "list") {
          const results = await ctx.redis!.lrange(key, 0, -1);
          const parsed = results.map((item: string) => {
            try {
              return JSON.parse(item);
            } catch {
              return item;
            }
          });
          return { values: parsed, count: parsed.length, key };
        } else if (actualKeyType === "set") {
          const members = await ctx.redis!.smembers(key);
          return { values: members, count: members.length, key };
        } else {
          const result = await ctx.redis!.get(key);
          if (!result) throw new Error("Key not found");
          try {
            return { value: JSON.parse(result), key };
          } catch {
            return { value: result, key };
          }
        }
      },
    },

    delete: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, keyType = "automatic" } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        
        const actualKeyType = keyType === "automatic" ? await ctx.redis!.type(key) : keyType;

        if (actualKeyType === "hash") {
          const { hashField } = input;
          if (hashField) {
            const deleted = await ctx.redis!.hdel(key, hashField);
            return { message: deleted > 0 ? "Hash field deleted" : "Hash field not found", key, hashField };
          }
        } else if (actualKeyType === "sets") {
          const { setMember } = input;
          if (setMember) {
            const deleted = await ctx.redis!.srem(key, setMember);
            return { message: deleted > 0 ? "Set member deleted" : "Set member not found", key, setMember };
          }
        }

        const deleted = await ctx.redis!.del(key);
        return { message: deleted > 0 ? "Key deleted" : "Key not found", key };
      },
    },

    increment: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const newValue = await ctx.redis!.incr(key);
        return { value: newValue, key };
      },
    },

    info: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const info = await ctx.redis!.info();
        const sections: Record<string, any> = {};
        let currentSection = "default";

        info.split("\r\n").forEach((line: string) => {
          if (line.startsWith("#")) {
            currentSection = line.substring(2).trim();
            sections[currentSection] = {};
          } else if (line.includes(":")) {
            const [k, v] = line.split(":");
            if (!sections[currentSection]) sections[currentSection] = {};
            sections[currentSection][k] = isNaN(Number(v)) ? v : Number(v);
          }
        });

        return { info: sections };
      },
    },

    keys: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { pattern = "*" } = input;
        const keys = await ctx.redis!.keys(pattern);
        return { keys, count: keys.length, pattern };
      },
    },

    pop: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, popDirection = "left" } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        
        const result = popDirection === "left"
          ? await ctx.redis!.lpop(key)
          : await ctx.redis!.rpop(key);

        if (!result) throw new Error("List is empty or key not found");

        try {
          return { value: JSON.parse(result), key };
        } catch {
          return { value: result, key };
        }
      },
    },

    push: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, value, scope, pushDirection = "left", ttl } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const serialized = typeof value === "object" ? JSON.stringify(value) : String(value);
        
        const length = pushDirection === "left"
          ? await ctx.redis!.lpush(key, serialized)
          : await ctx.redis!.rpush(key, serialized);

        if (ttl && ttl > 0) {
          await ctx.redis!.expire(key, ttl);
        }

        return { message: `Value pushed to ${pushDirection} of list`, length, key };
      },
    },

    publish: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { channel, value } = input;
        if (!channel) throw new Error("Channel is required for publish operation");

        const serialized = typeof value === "object" ? JSON.stringify(value) : String(value);
        const subscribers = await ctx.redis!.publish(channel, serialized);

        return { message: `Message published to ${subscribers} subscriber(s)`, channel, subscribers };
      },
    },

    // Set operations
    sadd: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, ttl } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const membersArray = parseMembers(input.members);
        if (membersArray.length === 0) throw new Error("At least one member is required");
        const added = await ctx.redis!.sadd(key, ...membersArray);
        if (ttl && ttl > 0) await ctx.redis!.expire(key, ttl);
        return { added, members: membersArray, key, message: `${added} member(s) added to set` };
      },
    },

    srem: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const membersArray = parseMembers(input.members);
        if (membersArray.length === 0) throw new Error("At least one member is required");
        const removed = await ctx.redis!.srem(key, ...membersArray);
        return { removed, members: membersArray, key, message: `${removed} member(s) removed from set` };
      },
    },

    smembers: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const members = await ctx.redis!.smembers(key);
        return { members, count: members.length, key };
      },
    },

    sismember: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, member } = input;
        if (!member) throw new Error("Member is required for SISMEMBER");
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const isMember = await ctx.redis!.sismember(key, member);
        return { isMember: isMember === 1, member, key };
      },
    },

    scard: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const count = await ctx.redis!.scard(key);
        return { count, key };
      },
    },

    sinter: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const otherKeysArray = parseOtherKeys(input.otherKeys, scope || "workflow", { userId: ctx.userId, workflowId: ctx.workflowId });
        const allKeys = [key, ...otherKeysArray];
        const intersection = await ctx.redis!.sinter(...allKeys);
        return { members: intersection, count: intersection.length, keys: allKeys };
      },
    },

    sunion: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const otherKeysArray = parseOtherKeys(input.otherKeys, scope || "workflow", { userId: ctx.userId, workflowId: ctx.workflowId });
        const allKeys = [key, ...otherKeysArray];
        const union = await ctx.redis!.sunion(...allKeys);
        return { members: union, count: union.length, keys: allKeys };
      },
    },

    sdiff: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const otherKeysArray = parseOtherKeys(input.otherKeys, scope || "workflow", { userId: ctx.userId, workflowId: ctx.workflowId });
        const allKeys = [key, ...otherKeysArray];
        const diff = await ctx.redis!.sdiff(...allKeys);
        return { members: diff, count: diff.length, keys: allKeys, message: "Members in first set but not in other sets" };
      },
    },

    // Hash operations
    hkeys: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const fields = await ctx.redis!.hkeys(key);
        return { fields, count: fields.length, key, message: `Found ${fields.length} field(s) in hash` };
      },
    },

    hvals: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const values = await ctx.redis!.hvals(key);
        const parsed = values.map((v: string) => {
          try {
            return JSON.parse(v);
          } catch {
            return v;
          }
        });
        return { values: parsed, count: parsed.length, key, message: `Found ${parsed.length} value(s) in hash` };
      },
    },

    hexists: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, hashField } = input;
        if (!hashField) throw new Error("Hash field is required for HEXISTS");
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const exists = await ctx.redis!.hexists(key, hashField);
        return { exists: exists === 1, field: hashField, key };
      },
    },

    hincrby: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, hashField, incrementBy = 1 } = input;
        if (!hashField) throw new Error("Hash field is required for HINCRBY");
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const newValue = await ctx.redis!.hincrby(key, hashField, incrementBy);
        return { value: newValue, field: hashField, incrementBy, key, message: `Field '${hashField}' incremented by ${incrementBy}, new value: ${newValue}` };
      },
    },

    // List operations
    lrange: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, startIndex = 0, endIndex = -1 } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const elements = await ctx.redis!.lrange(key, startIndex, endIndex);
        const parsed = elements.map((item: string) => {
          try {
            return JSON.parse(item);
          } catch {
            return item;
          }
        });
        return { values: parsed, count: parsed.length, startIndex, endIndex, key, message: `Retrieved ${parsed.length} element(s) from index ${startIndex} to ${endIndex}` };
      },
    },

    llen: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const length = await ctx.redis!.llen(key);
        return { length, key, message: `List contains ${length} element(s)` };
      },
    },

    lindex: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, index } = input;
        if (index === undefined) throw new Error("Index is required for LINDEX");
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const element = await ctx.redis!.lindex(key, index);
        if (element === null) throw new Error("Index out of range or list not found");
        try {
          return { value: JSON.parse(element), key, index };
        } catch {
          return { value: element, key, index };
        }
      },
    },

    lset: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, index, value } = input;
        if (index === undefined) throw new Error("Index is required for LSET");
        if (value === undefined) throw new Error("Value is required for LSET");
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const serialized = typeof value === "object" ? JSON.stringify(value) : String(value);
        await ctx.redis!.lset(key, index, serialized);
        return { key, index, message: `Element at index ${index} updated successfully` };
      },
    },

    ltrim: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, startIndex = 0, endIndex = -1 } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        await ctx.redis!.ltrim(key, startIndex, endIndex);
        return { key, startIndex, endIndex, message: `List trimmed to range ${startIndex} to ${endIndex}` };
      },
    },

    // Sorted set operations
    zadd: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, score, scoreMembers, member, ttl } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });

        if (scoreMembers) {
          const pairs = parseScoreMembers(scoreMembers);
          if (pairs.length === 0) throw new Error("Invalid score-member pairs format");
          const args: (string | number)[] = [];
          pairs.forEach((p) => {
            args.push(p.score, p.member);
          });
          const added = await ctx.redis!.zadd(key, ...args);
          if (ttl && ttl > 0) await ctx.redis!.expire(key, ttl);
          return { added, pairs, key, message: `${added} member(s) added to sorted set` };
        }

        if (score === undefined || !member) {
          throw new Error("Score and member are required, or provide scoreMembers for batch");
        }
        const added = await ctx.redis!.zadd(key, score, member);
        if (ttl && ttl > 0) await ctx.redis!.expire(key, ttl);
        return { added, score, member, key, message: added ? "Member added" : "Member score updated" };
      },
    },

    zrange: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, startIndex = 0, endIndex = -1, withScores = "true", reverseOrder = "false" } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const useRev = reverseOrder === "true" || reverseOrder === true;
        const includeScores = withScores === "true" || withScores === true;

        let results: string[];
        if (useRev) {
          results = includeScores
            ? await ctx.redis!.zrevrange(key, startIndex, endIndex, "WITHSCORES")
            : await ctx.redis!.zrevrange(key, startIndex, endIndex);
        } else {
          results = includeScores
            ? await ctx.redis!.zrange(key, startIndex, endIndex, "WITHSCORES")
            : await ctx.redis!.zrange(key, startIndex, endIndex);
        }

        if (includeScores) {
          const members: Array<{ member: string; score: number }> = [];
          for (let i = 0; i < results.length; i += 2) {
            members.push({ member: results[i], score: parseFloat(results[i + 1]) });
          }
          return { members, count: members.length, key, startIndex, endIndex };
        }

        return { members: results, count: results.length, key, startIndex, endIndex };
      },
    },

    zscore: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, member } = input;
        if (!member) throw new Error("Member is required for ZSCORE");
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const scoreVal = await ctx.redis!.zscore(key, member);
        if (scoreVal === null) throw new Error("Member not found in sorted set");
        return { score: parseFloat(scoreVal), member, key };
      },
    },

    zcount: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, minScore = "-inf", maxScore = "+inf" } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const count = await ctx.redis!.zcount(key, minScore, maxScore);
        return { count, minScore, maxScore, key };
      },
    },

    zincrby: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope, member, score } = input;
        if (!member) throw new Error("Member is required for ZINCRBY");
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const increment = score ?? 1;
        const newScore = await ctx.redis!.zincrby(key, increment, member);
        return { newScore: parseFloat(newScore), member, increment, key, message: `Member '${member}' score incremented by ${increment}, new score: ${newScore}` };
      },
    },

    zrem: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { key: rawKey, scope } = input;
        const key = buildKey(scope || "workflow", rawKey || "", { userId: ctx.userId, workflowId: ctx.workflowId });
        const membersArray = parseMembers(input.members);
        if (membersArray.length === 0) throw new Error("At least one member is required for ZREM");
        const removed = await ctx.redis!.zrem(key, ...membersArray);
        return { removed, members: membersArray, key, message: `${removed} member(s) removed from sorted set` };
      },
    },

    // Pub/Sub operations
    pubsub_channels: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const { channelPattern = "*" } = input;
        const channels = await ctx.redis!.pubsub("CHANNELS", channelPattern);
        return { channels, count: channels.length, pattern: channelPattern, message: `Found ${channels.length} active channel(s)` };
      },
    },

    pubsub_numsub: {
      handler: async (input: StorageInput, ctx: StorageContext) => {
        const channelList = parseMembers(input.channels);
        if (channelList.length === 0) throw new Error("At least one channel is required");
        const result = (await ctx.redis!.pubsub("NUMSUB", ...channelList)) as any[];
        const subscribers: Record<string, number> = {};
        for (let i = 0; i < result.length; i += 2) {
          subscribers[result[i] as string] = result[i + 1] as number;
        }
        return { subscribers, channels: channelList, message: `Subscriber counts for ${channelList.length} channel(s)` };
      },
    },
  },
};

export default redisConfig;
