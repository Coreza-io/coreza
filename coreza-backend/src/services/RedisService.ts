import Redis from "ioredis";
import logger from "../utils/logger";
import { NodeResult } from "../nodes/types";
import { CredentialManager } from "../utils/credentialManager";

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
  scoreMembers?: string | Array<{score: number, member: string}>;
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

// Helper to get or create user's Redis connection
async function getUserRedis(userId: string, credentialId: string): Promise<Redis> {
  const cacheKey = `${userId}:${credentialId}`;
  
  if (userRedisConnections.has(cacheKey)) {
    const redis = userRedisConnections.get(cacheKey)!;
    if (redis.status === 'ready' || redis.status === 'connecting') {
      return redis;
    }
    userRedisConnections.delete(cacheKey);
  }
  
  const { credentials } = await CredentialManager.getCredentials(userId, "redis", credentialId);
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
    redis.once('ready', resolve);
    redis.once('error', reject);
    setTimeout(() => reject(new Error('Redis connection timeout')), 10000);
  });
  
  userRedisConnections.set(cacheKey, redis);
  logger.info({ userId, credentialId, host: creds.host }, 'User Redis connection established');
  return redis;
}

export class RedisService {
  private static buildKey(scope: string, key: string, context: { userId?: string; workflowId?: string }): string {
    switch (scope) {
      case 'global':
        return `global:${key}`;
      case 'user':
        return `user:${context.userId}:${key}`;
      case 'workflow':
      default:
        return `workflow:${context.workflowId}:${key}`;
    }
  }

  private static async detectKeyType(redis: Redis, key: string, value: any): Promise<string> {
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

  static async execute(params: RedisOperationParams): Promise<NodeResult> {
    try {
      const redis = await getUserRedis(params.userId, params.credentialId);
      const { operation, key: rawKey, value, ttl, scope, keyType = "automatic" } = params;

      const key = ["info", "keys"].includes(operation)
        ? rawKey
        : this.buildKey(scope || 'workflow', rawKey || '', {
            userId: params.userId,
            workflowId: params.workflowId,
          });

      switch (operation) {
        case "set": {
          const actualKeyType = keyType === "automatic" ? await this.detectKeyType(redis, key, value) : keyType;
          
          if (actualKeyType === "hash") {
            const { hashField } = params;
            if (!hashField) {
              return { success: false, error: "Hash field is required for hash type" };
            }
            const serialized = typeof value === "object" ? JSON.stringify(value) : String(value);
            await redis.hset(key, hashField, serialized);
          } else if (actualKeyType === "list") {
            const serialized = typeof value === "object" ? JSON.stringify(value) : String(value);
            await redis.rpush(key, serialized);
          } else if (actualKeyType === "sets") {
            const { setMember } = params;
            if (!setMember) {
              return { success: false, error: "Set member is required for sets type" };
            }
            await redis.sadd(key, setMember);
          } else {
            const serialized = typeof value === "object" ? JSON.stringify(value) : String(value);
            await redis.set(key, serialized);
          }
          
          if (ttl && ttl > 0) {
            await redis.expire(key, ttl);
          }
          return { success: true, message: "Value set successfully", key, keyType: actualKeyType };
        }

        case "get": {
          const actualKeyType = keyType === "automatic" ? await redis.type(key) : keyType;
          
          if (actualKeyType === "hash") {
            const { hashField } = params;
            if (hashField) {
              const result = await redis.hget(key, hashField);
              if (!result) {
                return { success: false, error: "Hash field not found", key, hashField };
              }
              try {
                return { success: true, value: JSON.parse(result), key, hashField };
              } catch {
                return { success: true, value: result, key, hashField };
              }
            } else {
              const result = await redis.hgetall(key);
              if (!result || Object.keys(result).length === 0) {
                return { success: false, error: "Hash not found or empty", key };
              }
              const parsed: Record<string, any> = {};
              for (const [k, v] of Object.entries(result)) {
                try {
                  parsed[k] = JSON.parse(v);
                } catch {
                  parsed[k] = v;
                }
              }
              return { success: true, value: parsed, key };
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
            return { success: true, values: parsed, count: parsed.length, key };
          } else if (actualKeyType === "set") {
            const members = await redis.smembers(key);
            return { success: true, values: members, count: members.length, key };
          } else {
            const result = await redis.get(key);
            if (!result) {
              return { success: false, error: "Key not found", key };
            }
            try {
              return { success: true, value: JSON.parse(result), key };
            } catch {
              return { success: true, value: result, key };
            }
          }
        }

        case "delete": {
          const actualKeyType = keyType === "automatic" ? await redis.type(key) : keyType;
          
          if (actualKeyType === "hash") {
            const { hashField } = params;
            if (hashField) {
              const deleted = await redis.hdel(key, hashField);
              return {
                success: deleted > 0,
                message: deleted > 0 ? "Hash field deleted" : "Hash field not found",
                key,
                hashField,
              };
            }
          } else if (actualKeyType === "sets") {
            const { setMember } = params;
            if (setMember) {
              const deleted = await redis.srem(key, setMember);
              return {
                success: deleted > 0,
                message: deleted > 0 ? "Set member deleted" : "Set member not found",
                key,
                setMember,
              };
            }
          }
          
          const deleted = await redis.del(key);
          return {
            success: deleted > 0,
            message: deleted > 0 ? "Key deleted" : "Key not found",
            key,
          };
        }

        case "increment": {
          const newValue = await redis.incr(key);
          return { success: true, value: newValue, key };
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
              const [key, value] = line.split(":");
              if (!sections[currentSection]) sections[currentSection] = {};
              sections[currentSection][key] = isNaN(Number(value)) ? value : Number(value);
            }
          });
          
          return { success: true, info: sections };
        }

        case "keys": {
          const { pattern = "*" } = params;
          const keys = await redis.keys(pattern);
          return { success: true, keys, count: keys.length, pattern };
        }

        case "pop": {
          const { popDirection = "left" } = params;
          const result = popDirection === "left" ? await redis.lpop(key) : await redis.rpop(key);
          
          if (!result) {
            return { success: false, error: "List is empty or key not found", key };
          }
          
          try {
            return { success: true, value: JSON.parse(result), key };
          } catch {
            return { success: true, value: result, key };
          }
        }

        case "publish": {
          const { channel } = params;
          if (!channel) {
            return { success: false, error: "Channel is required for publish operation" };
          }
          
          const serialized = typeof value === "object" ? JSON.stringify(value) : String(value);
          const subscribers = await redis.publish(channel, serialized);
          
          return {
            success: true,
            message: `Message published to ${subscribers} subscriber(s)`,
            channel,
            subscribers,
          };
        }

        case "push": {
          const { pushDirection = "left" } = params;
          const serialized = typeof value === "object" ? JSON.stringify(value) : String(value);
          const length = pushDirection === "left"
            ? await redis.lpush(key, serialized)
            : await redis.rpush(key, serialized);
          
          if (ttl && ttl > 0) {
            await redis.expire(key, ttl);
          }
          
          return {
            success: true,
            message: `Value pushed to ${pushDirection} of list`,
            length,
            key,
          };
        }

        case "sadd": {
          const membersArray = this.parseMembers(params.members);
          if (membersArray.length === 0) {
            return { success: false, error: "At least one member is required" };
          }
          const added = await redis.sadd(key, ...membersArray);
          if (ttl && ttl > 0) {
            await redis.expire(key, ttl);
          }
          return { 
            success: true, 
            added, 
            members: membersArray, 
            key,
            message: `${added} member(s) added to set`
          };
        }

        case "srem": {
          const membersArray = this.parseMembers(params.members);
          if (membersArray.length === 0) {
            return { success: false, error: "At least one member is required" };
          }
          const removed = await redis.srem(key, ...membersArray);
          return { 
            success: true, 
            removed, 
            members: membersArray, 
            key,
            message: `${removed} member(s) removed from set`
          };
        }

        case "smembers": {
          const members = await redis.smembers(key);
          return { 
            success: true, 
            members, 
            count: members.length, 
            key 
          };
        }

        case "sismember": {
          const { member } = params;
          if (!member) {
            return { success: false, error: "Member is required for SISMEMBER" };
          }
          const isMember = await redis.sismember(key, member);
          return { 
            success: true, 
            isMember: isMember === 1, 
            member, 
            key 
          };
        }

        case "scard": {
          const count = await redis.scard(key);
          return { success: true, count, key };
        }

        case "sinter": {
          const otherKeysArray = this.parseOtherKeys(params.otherKeys, scope || 'workflow', params);
          const allKeys = [key, ...otherKeysArray];
          const intersection = await redis.sinter(...allKeys);
          return { 
            success: true, 
            members: intersection, 
            count: intersection.length, 
            keys: allKeys 
          };
        }

        case "sunion": {
          const otherKeysArray = this.parseOtherKeys(params.otherKeys, scope || 'workflow', params);
          const allKeys = [key, ...otherKeysArray];
          const union = await redis.sunion(...allKeys);
          return { 
            success: true, 
            members: union, 
            count: union.length, 
            keys: allKeys 
          };
        }

        case "sdiff": {
          const otherKeysArray = this.parseOtherKeys(params.otherKeys, scope || 'workflow', params);
          const allKeys = [key, ...otherKeysArray];
          const diff = await redis.sdiff(...allKeys);
          return { 
            success: true, 
            members: diff, 
            count: diff.length, 
            keys: allKeys,
            message: "Members in first set but not in other sets"
          };
        }

        case "hkeys": {
          const fields = await redis.hkeys(key);
          return { 
            success: true, 
            fields, 
            count: fields.length, 
            key,
            message: `Found ${fields.length} field(s) in hash`
          };
        }

        case "hvals": {
          const values = await redis.hvals(key);
          const parsed = values.map(v => {
            try { return JSON.parse(v); } catch { return v; }
          });
          return { 
            success: true, 
            values: parsed, 
            count: parsed.length, 
            key,
            message: `Found ${parsed.length} value(s) in hash`
          };
        }

        case "hexists": {
          const { hashField } = params;
          if (!hashField) {
            return { success: false, error: "Hash field is required for HEXISTS" };
          }
          const exists = await redis.hexists(key, hashField);
          return { 
            success: true, 
            exists: exists === 1, 
            field: hashField, 
            key 
          };
        }

        case "hincrby": {
          const { hashField, incrementBy = 1 } = params;
          if (!hashField) {
            return { success: false, error: "Hash field is required for HINCRBY" };
          }
          const newValue = await redis.hincrby(key, hashField, incrementBy);
          return { 
            success: true, 
            value: newValue, 
            field: hashField, 
            incrementBy,
            key,
            message: `Field '${hashField}' incremented by ${incrementBy}, new value: ${newValue}`
          };
        }

        case "lrange": {
          const { startIndex = 0, endIndex = -1 } = params;
          const elements = await redis.lrange(key, startIndex, endIndex);
          const parsed = elements.map(item => {
            try { return JSON.parse(item); } catch { return item; }
          });
          return { 
            success: true, 
            values: parsed, 
            count: parsed.length, 
            startIndex,
            endIndex,
            key,
            message: `Retrieved ${parsed.length} element(s) from index ${startIndex} to ${endIndex}`
          };
        }

        case "llen": {
          const length = await redis.llen(key);
          return { 
            success: true, 
            length, 
            key,
            message: `List contains ${length} element(s)`
          };
        }

        case "lindex": {
          const { index } = params;
          if (index === undefined) {
            return { success: false, error: "Index is required for LINDEX" };
          }
          const element = await redis.lindex(key, index);
          if (element === null) {
            return { success: false, error: "Index out of range or list not found", key, index };
          }
          try {
            return { success: true, value: JSON.parse(element), key, index };
          } catch {
            return { success: true, value: element, key, index };
          }
        }

        case "lset": {
          const { index, value } = params;
          if (index === undefined) {
            return { success: false, error: "Index is required for LSET" };
          }
          if (value === undefined) {
            return { success: false, error: "Value is required for LSET" };
          }
          const serialized = typeof value === "object" ? JSON.stringify(value) : String(value);
          await redis.lset(key, index, serialized);
          return { 
            success: true, 
            key, 
            index,
            message: `Element at index ${index} updated successfully`
          };
        }

        case "ltrim": {
          const { startIndex = 0, endIndex = -1 } = params;
          await redis.ltrim(key, startIndex, endIndex);
          return { 
            success: true, 
            key,
            startIndex,
            endIndex,
            message: `List trimmed to range ${startIndex} to ${endIndex}`
          };
        }

        case "zadd": {
          const { score, scoreMembers, member } = params;
          
          // Handle batch add with score:member pairs
          if (scoreMembers) {
            const pairs = this.parseScoreMembers(scoreMembers);
            if (pairs.length === 0) {
              return { success: false, error: "Invalid score-member pairs format" };
            }
            const args: (string | number)[] = [];
            pairs.forEach(p => { args.push(p.score, p.member); });
            const added = await redis.zadd(key, ...args);
            if (ttl && ttl > 0) await redis.expire(key, ttl);
            return { success: true, added, pairs, key, message: `${added} member(s) added to sorted set` };
          }
          
          // Handle single member add
          if (score === undefined || !member) {
            return { success: false, error: "Score and member are required, or provide scoreMembers for batch" };
          }
          const added = await redis.zadd(key, score, member);
          if (ttl && ttl > 0) await redis.expire(key, ttl);
          return { success: true, added, score, member, key, message: added ? "Member added" : "Member score updated" };
        }

        case "zrange": {
          const { startIndex = 0, endIndex = -1, withScores = "true", reverseOrder = "false" } = params;
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
            const members: Array<{member: string, score: number}> = [];
            for (let i = 0; i < results.length; i += 2) {
              members.push({ member: results[i], score: parseFloat(results[i + 1]) });
            }
            return { success: true, members, count: members.length, key, startIndex, endIndex };
          }
          
          return { success: true, members: results, count: results.length, key, startIndex, endIndex };
        }

        case "zscore": {
          const { member } = params;
          if (!member) {
            return { success: false, error: "Member is required for ZSCORE" };
          }
          const score = await redis.zscore(key, member);
          if (score === null) {
            return { success: false, error: "Member not found in sorted set", key, member };
          }
          return { success: true, score: parseFloat(score), member, key };
        }

        case "zcount": {
          const { minScore = "-inf", maxScore = "+inf" } = params;
          const count = await redis.zcount(key, minScore, maxScore);
          return { success: true, count, minScore, maxScore, key };
        }

        case "zincrby": {
          const { member, score } = params;
          if (!member) {
            return { success: false, error: "Member is required for ZINCRBY" };
          }
          const increment = score ?? 1;
          const newScore = await redis.zincrby(key, increment, member);
          return { 
            success: true, 
            newScore: parseFloat(newScore), 
            member, 
            increment, 
            key,
            message: `Member '${member}' score incremented by ${increment}, new score: ${newScore}`
          };
        }

        case "zrem": {
          const membersArray = this.parseMembers(params.members);
          if (membersArray.length === 0) {
            return { success: false, error: "At least one member is required for ZREM" };
          }
          const removed = await redis.zrem(key, ...membersArray);
          return { 
            success: true, 
            removed, 
            members: membersArray, 
            key,
        message: `${removed} member(s) removed from sorted set`
      };
    }

    case "pubsub_channels": {
      const { channelPattern = "*" } = params;
      const channels = await redis.pubsub("CHANNELS", channelPattern);
      return { 
        success: true, 
        channels, 
        count: channels.length, 
        pattern: channelPattern,
        message: `Found ${channels.length} active channel(s)`
      };
    }

    case "pubsub_numsub": {
      const channelList = this.parseMembers(params.channels);
      if (channelList.length === 0) {
        return { success: false, error: "At least one channel is required" };
      }
      const result = await redis.pubsub("NUMSUB", ...channelList) as any[];
      // Result is [channel1, count1, channel2, count2, ...]
      const subscribers: Record<string, number> = {};
      for (let i = 0; i < result.length; i += 2) {
        subscribers[result[i] as string] = result[i + 1] as number;
      }
      return { 
        success: true, 
        subscribers, 
        channels: channelList,
        message: `Subscriber counts for ${channelList.length} channel(s)`
      };
    }

    default:
      return { success: false, error: `Unsupported operation: ${operation}` };
  }
    } catch (error: any) {
      logger.error({ err: error, operation: params.operation, key: params.key }, "Redis operation failed");
      return { success: false, error: error.message };
    }
  }

  private static parseMembers(members: string | string[] | undefined): string[] {
    if (!members) return [];
    if (Array.isArray(members)) return members.map(String);
    return members.split(',').map(m => m.trim()).filter(Boolean);
  }

  private static parseOtherKeys(
    otherKeys: string | string[] | undefined, 
    scope: string, 
    params: RedisOperationParams
  ): string[] {
    if (!otherKeys) return [];
    const keys = Array.isArray(otherKeys) 
      ? otherKeys 
      : otherKeys.split(',').map(k => k.trim()).filter(Boolean);
    
    return keys.map(k => this.buildKey(scope, k, {
      userId: params.userId,
      workflowId: params.workflowId
    }));
  }

  private static parseScoreMembers(
    input: string | Array<{score: number, member: string}> | undefined
  ): Array<{score: number, member: string}> {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    
    // Parse "score1:member1, score2:member2" format
    return input.split(',')
      .map(pair => pair.trim())
      .filter(Boolean)
      .map(pair => {
        const [scoreStr, ...memberParts] = pair.split(':');
        const score = parseFloat(scoreStr.trim());
        const member = memberParts.join(':').trim();
        return { score, member };
      })
      .filter(p => !isNaN(p.score) && p.member);
  }
}
