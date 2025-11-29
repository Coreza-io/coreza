import Redis from "ioredis";
import logger from "../utils/logger";
import { NodeResult } from "../nodes/types";
import { CredentialManager } from "../utils/credentialManager";

// Cache for user Redis connections
const userRedisConnections = new Map<string, Redis>();

interface RedisOperationParams {
  operation: string;
  scope?: string;
  key: string;
  value?: any;
  field?: string;
  ttl?: number;
  listStart?: number;
  listEnd?: number;
  userId: string;
  credentialId: string;
  context?: {
    userId?: string;
    workflowId?: string;
  };
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

  static async execute(params: RedisOperationParams): Promise<NodeResult> {
    try {
      const { userId, credentialId, operation, scope = 'workflow', key, value, field, ttl = 0, listStart = 0, listEnd = -1, context = {} } = params;
      
      // Get user's Redis connection
      const redis = await getUserRedis(userId, credentialId);
      
      if (!key) {
        return { success: false, error: "key is required" };
      }

      const scopedKey = this.buildKey(scope, key, context);
      let result: any;

      switch (operation) {
        case 'set':
          const serialized = typeof value === 'string' ? value : JSON.stringify(value);
          if (ttl > 0) {
            await redis.set(scopedKey, serialized, 'EX', ttl);
          } else {
            await redis.set(scopedKey, serialized);
          }
          result = { success: true, key: scopedKey, operation: 'set' };
          logger.info({ scopedKey, ttl }, 'Redis SET operation');
          break;

        case 'get':
          const stored = await redis.get(scopedKey);
          try {
            result = stored ? JSON.parse(stored) : null;
          } catch {
            result = stored;
          }
          logger.debug({ scopedKey }, 'Redis GET operation');
          break;

        case 'delete':
          const deleted = await redis.del(scopedKey);
          result = { success: true, deleted: deleted > 0 };
          logger.info({ scopedKey, deleted: deleted > 0 }, 'Redis DEL operation');
          break;

        case 'exists':
          const exists = await redis.exists(scopedKey);
          result = { exists: exists > 0 };
          logger.debug({ scopedKey, exists: exists > 0 }, 'Redis EXISTS operation');
          break;

        case 'lpush':
          const listValue = typeof value === 'string' ? value : JSON.stringify(value);
          await redis.lpush(scopedKey, listValue);
          if (ttl > 0) await redis.expire(scopedKey, ttl);
          result = { success: true, key: scopedKey, operation: 'lpush' };
          logger.info({ scopedKey, ttl }, 'Redis LPUSH operation');
          break;

        case 'lrange':
          const listItems = await redis.lrange(scopedKey, listStart, listEnd);
          result = listItems.map(item => {
            try { return JSON.parse(item); } catch { return item; }
          });
          logger.debug({ scopedKey, listStart, listEnd, count: listItems.length }, 'Redis LRANGE operation');
          break;

        case 'hset':
          if (!field) return { success: false, error: "field is required for hset" };
          const hashValue = typeof value === 'string' ? value : JSON.stringify(value);
          await redis.hset(scopedKey, field, hashValue);
          if (ttl > 0) await redis.expire(scopedKey, ttl);
          result = { success: true, key: scopedKey, field, operation: 'hset' };
          logger.info({ scopedKey, field, ttl }, 'Redis HSET operation');
          break;

        case 'hget':
          if (!field) return { success: false, error: "field is required for hget" };
          const hashField = await redis.hget(scopedKey, field);
          try {
            result = hashField ? JSON.parse(hashField) : null;
          } catch {
            result = hashField;
          }
          logger.debug({ scopedKey, field }, 'Redis HGET operation');
          break;

        case 'hgetall':
          const allFields = await redis.hgetall(scopedKey);
          result = {};
          for (const [k, v] of Object.entries(allFields)) {
            try { result[k] = JSON.parse(v as string); } catch { result[k] = v; }
          }
          logger.debug({ scopedKey, fieldCount: Object.keys(result).length }, 'Redis HGETALL operation');
          break;

        case 'incr':
          result = await redis.incr(scopedKey);
          logger.info({ scopedKey, newValue: result }, 'Redis INCR operation');
          break;

        case 'setnx':
          const nxValue = typeof value === 'string' ? value : JSON.stringify(value);
          const wasSet = await redis.setnx(scopedKey, nxValue);
          if (wasSet && ttl > 0) await redis.expire(scopedKey, ttl);
          result = { success: true, wasSet: wasSet === 1 };
          logger.info({ scopedKey, wasSet: wasSet === 1, ttl }, 'Redis SETNX operation');
          break;

        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }

      return { success: true, data: result };
    } catch (error) {
      logger.error({ err: error }, "Redis service error");
      return {
        success: false,
        error: `Redis operation failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
