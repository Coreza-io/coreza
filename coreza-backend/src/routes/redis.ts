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
      scope,
      key,
      value,
      keyType,
      pattern,
      channel,
      hashField,
      setMember,
      popDirection,
      pushDirection,
      members,
      member,
      otherKeys,
      incrementBy,
      ttl,
      workflow_id,
    } = req.body;

    if (!user_id || !credential_id || !operation) {
      return res
        .status(400)
        .json({ error: "user_id, credential_id, and operation are required" });
    }

    const RedisService = (await import("../services/RedisService")).RedisService;
    
    const result = await RedisService.execute({
      userId: user_id,
      credentialId: credential_id,
      operation,
      scope,
      key,
      value,
      keyType,
      pattern,
      channel,
      hashField,
      setMember,
      popDirection,
      pushDirection,
      members,
      member,
      otherKeys,
      incrementBy,
      ttl,
      workflowId: workflow_id,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error: any) {
    logger.error({ err: error }, "Redis store operation error");
    res.status(500).json({ 
      error: "Redis operation failed",
      details: error.message 
    });
  }
});

export default router;
