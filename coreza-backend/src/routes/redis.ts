import express from "express";
import { getRedis } from "../config/redis";
import logger from "../utils/logger";

const router = express.Router();

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

router.post("/store", async (req, res) => {
  try {
    const { operation, scope = 'workflow', key, value, field, ttl = 0, listStart = 0, listEnd = -1, context = {} } = req.body;
    const redis = getRedis();
    
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
