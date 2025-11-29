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
  ttl?: number;
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
}
