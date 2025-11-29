import express from "express";
import Redis from "ioredis";
import { getRedis } from "../config/redis";
import logger from "../utils/logger";
import { CredentialManager } from "../utils/credentialManager";
import { CredentialValidator } from "../utils/credentialValidator";

const router = express.Router();

// Cache for user Redis connections (reuse connections per user+credential)
const userRedisConnections = new Map<string, Redis>();

// Helper to get or create user's Redis connection
async function getUserRedis(userId: string, credentialId: string): Promise<Redis> {
  const cacheKey = `${userId}:${credentialId}`;
  
  // Return cached connection if exists and ready
  if (userRedisConnections.has(cacheKey)) {
    const redis = userRedisConnections.get(cacheKey)!;
    if (redis.status === 'ready' || redis.status === 'connecting') {
      return redis;
    }
    // Remove stale connection
    userRedisConnections.delete(cacheKey);
  }
  
  // Fetch and decrypt user's Redis credentials
  const { credentials } = await CredentialManager.getCredentials(userId, "redis", credentialId);
  const creds = credentials?.client_json;
  
  if (!creds?.host) {
    throw new Error("Invalid Redis credentials - host is required");
  }
  
  // Create new Redis connection with user's credentials
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
  
  // Wait for connection
  await new Promise((resolve, reject) => {
    redis.once('ready', resolve);
    redis.once('error', reject);
    setTimeout(() => reject(new Error('Redis connection timeout')), 10000);
  });
  
  userRedisConnections.set(cacheKey, redis);
  logger.info({ userId, credentialId, host: creds.host }, 'User Redis connection established');
  return redis;
}

// Helper to test Redis connection before saving
async function testRedisConnection(creds: any): Promise<{ success: boolean; error?: string }> {
  let testRedis: Redis | null = null;
  try {
    testRedis = new Redis({
      host: creds.host,
      port: parseInt(creds.port || "6379", 10),
      password: creds.password || undefined,
      username: creds.user || undefined,
      db: parseInt(creds.database || "0", 10),
      tls: creds.tls === "true" ? { rejectUnauthorized: false } : undefined,
      connectTimeout: 5000,
      lazyConnect: false,
    });
    
    // Wait for connection with timeout
    await new Promise((resolve, reject) => {
      testRedis!.once('ready', resolve);
      testRedis!.once('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });
    
    // Test PING
    const pong = await testRedis.ping();
    if (pong !== 'PONG') {
      throw new Error('PING test failed');
    }
    
    return { success: true };
  } catch (error) {
    logger.error({ err: error, host: creds.host }, 'Redis connection test failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    if (testRedis) {
      await testRedis.quit();
    }
  }
}

// Helper to build scoped key
function buildKey(scope: string, key: string, context: { userId?: string; workflowId?: string }): string {
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

// GET /redis/credentials - List user's Redis credentials
router.get("/credentials", async (req, res) => {
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }
    
    const credentials = await CredentialManager.listCredentials(user_id as string, "redis");
    
    res.json({
      success: true,
      credentials: credentials.map(c => ({ 
        id: c.name, 
        name: c.name,
        created_at: c.created_at 
      }))
    });
  } catch (error) {
    logger.error({ err: error }, "Error fetching Redis credentials");
    res.status(500).json({
      error: "Failed to fetch Redis credentials",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// POST /redis/auth - Store Redis credentials with connection validation
router.post("/auth", async (req, res) => {
  try {
    const { user_id, credential_name, host, port, password, user, database, tls } = req.body;
    
    if (!user_id || !credential_name || !host) {
      return res.status(400).json({ error: "user_id, credential_name, and host are required" });
    }
    
    const credentials = { host, port, password, user, database, tls };
    
    // Validate credential structure
    const validation = CredentialValidator.validateCredentials("redis", credentials);
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: "Invalid credentials", 
        details: validation.errors 
      });
    }
    
    // Test connection before saving
    logger.info({ user_id, credential_name, host }, 'Testing Redis connection');
    const testResult = await testRedisConnection(credentials);
    
    if (!testResult.success) {
      return res.status(400).json({ 
        error: `Connection failed: ${testResult.error}`,
        details: "Please verify your Redis host, port, password, and network connectivity"
      });
    }
    
    // Save credentials
    const credentialId = await CredentialManager.saveCredentials(
      user_id,
      "redis",
      credential_name,
      credentials,
      "api"
    );
    
    logger.info({ user_id, credential_name, credentialId }, 'Redis credentials saved successfully');
    
    res.json({ 
      success: true, 
      credential_id: credentialId,
      message: "Redis connection validated and saved successfully"
    });
  } catch (error) {
    logger.error({ err: error }, "Error saving Redis credentials");
    res.status(500).json({
      error: "Failed to save Redis credentials",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// POST /redis/store - Execute Redis operations using user's Redis connection
router.post("/store", async (req, res) => {
  try {
    const { 
      user_id, 
      credential_id, 
      operation, 
      scope = 'workflow', 
      key, 
      value, 
      field, 
      ttl = 0, 
      listStart = 0, 
      listEnd = -1, 
      context = {} 
    } = req.body;
    
    if (!user_id || !credential_id) {
      return res.status(400).json({ error: "user_id and credential_id are required" });
    }
    
    // Get user's Redis connection
    const redis = await getUserRedis(user_id, credential_id);
    
    if (!key) {
      return res.status(400).json({ error: "key is required" });
    }

    const scopedKey = buildKey(scope, key, context);
    let result: any;

    switch (operation) {
      case 'set':
        // Serialize value (supports objects/arrays)
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
          result = stored; // Return as string if not JSON
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
        if (!field) return res.status(400).json({ error: "field is required for hset" });
        const hashValue = typeof value === 'string' ? value : JSON.stringify(value);
        await redis.hset(scopedKey, field, hashValue);
        if (ttl > 0) await redis.expire(scopedKey, ttl);
        result = { success: true, key: scopedKey, field, operation: 'hset' };
        logger.info({ scopedKey, field, ttl }, 'Redis HSET operation');
        break;

      case 'hget':
        if (!field) return res.status(400).json({ error: "field is required for hget" });
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
        return res.status(400).json({ error: `Unknown operation: ${operation}` });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error({ err: error }, "Redis store error");
    res.status(500).json({
      error: "Redis operation failed",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
