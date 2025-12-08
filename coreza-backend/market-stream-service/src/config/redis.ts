import Redis, { RedisOptions } from "ioredis";

const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
};

const normalizeRedisInput = (rawValue: string | undefined) => {
  if (!rawValue) {
    return { url: undefined, hasTlsFlag: false };
  }

  const normalizedValue = rawValue.replace(/%20/g, " ").trim();
  const hasTlsFlag = /(^|\s)--tls(\s|$)/.test(normalizedValue);
  const urlMatch = normalizedValue.match(/(rediss?:\/\/\S+)/);

  return {
    url: urlMatch ? urlMatch[1] : normalizedValue,
    hasTlsFlag,
  };
};

const resolveRedisConfig = (
  primaryEnvVar: "REDIS_QUEUE_URL" | "REDIS_CACHE_URL",
): { url: string | undefined; hasTlsFlag: boolean; sourceEnv: string } => {
  const primary = normalizeRedisInput(process.env[primaryEnvVar]);
  if (primary.url) {
    return { ...primary, sourceEnv: primaryEnvVar };
  }

  const fallback = normalizeRedisInput(process.env.REDIS_URL);
  return { ...fallback, sourceEnv: fallback.url ? "REDIS_URL" : primaryEnvVar };
};

const buildRedisOptions = (
  redisUrl: string | undefined,
  hasTlsFlag: boolean,
): RedisOptions => {
  const shouldUseTls =
    process.env.REDIS_TLS === "true" ||
    hasTlsFlag ||
    (redisUrl?.startsWith("rediss://") ?? false);

  return {
    ...connectionOptions,
    ...(shouldUseTls
      ? {
          tls: {
            rejectUnauthorized:
              process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== "false",
          },
        }
      : {}),
  };
};

const getRedisOrThrow = (
  resolveResult: { url: string | undefined; hasTlsFlag: boolean },
  usage: string,
): { redisUrl: string; hasTlsFlag: boolean } => {
  if (!resolveResult.url) {
    throw new Error(`Redis URL is required for ${usage}. Set REDIS_URL or the dedicated environment variable.`);
  }

  return { redisUrl: resolveResult.url, hasTlsFlag: resolveResult.hasTlsFlag };
};

// ========== QUEUE REDIS (Latency-Critical) ==========
let redisQueueInstance: Redis | null = null;
let redisQueuePubInstance: Redis | null = null;
let redisQueueSubInstance: Redis | null = null;

// ========== CACHE REDIS (Medium-Latency) ==========
let redisCacheInstance: Redis | null = null;

export const connectionOptions: RedisOptions = {
  ...baseOptions,
};

/**
 * Get Redis for BullMQ queues + Pub/Sub (latency-critical)
 * Uses REDIS_QUEUE_URL with fallback to REDIS_URL
 */
export function getRedisQueue(): Redis {
  if (redisQueueInstance) return redisQueueInstance;

  const resolved = resolveRedisConfig("REDIS_QUEUE_URL");
  const { redisUrl, hasTlsFlag } = getRedisOrThrow(resolved, "BullMQ queue and pub/sub operations");

  redisQueueInstance = new Redis(redisUrl, buildRedisOptions(redisUrl, hasTlsFlag));
  return redisQueueInstance;
}

/**
 * Get Redis Pub/Sub for market data streaming (latency-critical)
 */
export function getRedisQueuePubSub(): { pub: Redis; sub: Redis } {
  if (redisQueuePubInstance && redisQueueSubInstance) {
    return { pub: redisQueuePubInstance, sub: redisQueueSubInstance };
  }

  const resolved = resolveRedisConfig("REDIS_QUEUE_URL");
  const { redisUrl, hasTlsFlag } = getRedisOrThrow(resolved, "Pub/Sub");
  const options = buildRedisOptions(redisUrl, hasTlsFlag);

  redisQueuePubInstance = new Redis(redisUrl, options);
  redisQueueSubInstance = new Redis(redisUrl, options);

  return { pub: redisQueuePubInstance, sub: redisQueueSubInstance };
}

/**
 * Create NEW Redis connections for Pub/Sub (not singletons)
 * Use this when services need isolated subscriber connections
 */
export function createRedisQueuePubSub(): { pub: Redis; sub: Redis } {
  const resolved = resolveRedisConfig("REDIS_QUEUE_URL");
  const { redisUrl, hasTlsFlag } = getRedisOrThrow(resolved, "Pub/Sub");
  const options = buildRedisOptions(redisUrl, hasTlsFlag);

  return {
    pub: new Redis(redisUrl, options),
    sub: new Redis(redisUrl, options),
  };
}

/**
 * Get Redis for caching (credentials, state, subscriptions)
 * Uses REDIS_CACHE_URL with fallback to REDIS_URL
 */
export function getRedisCache(): Redis {
  if (redisCacheInstance) return redisCacheInstance;

  const resolved = resolveRedisConfig("REDIS_CACHE_URL");
  const { redisUrl, hasTlsFlag } = getRedisOrThrow(resolved, "caching operations");

  redisCacheInstance = new Redis(redisUrl, buildRedisOptions(redisUrl, hasTlsFlag));
  return redisCacheInstance;
}

// Backward compatibility (deprecated, maps to getRedisQueue)
export const getRedis = getRedisQueue;
export const getRedisPubSub = getRedisQueuePubSub;
export const createRedisPubSub = createRedisQueuePubSub;

export async function closeRedis(): Promise<void> {
  if (redisQueueInstance) {
    await redisQueueInstance.quit();
    redisQueueInstance = null;
  }
  if (redisQueuePubInstance) {
    await redisQueuePubInstance.quit();
    redisQueuePubInstance = null;
  }
  if (redisQueueSubInstance) {
    await redisQueueSubInstance.quit();
    redisQueueSubInstance = null;
  }
  if (redisCacheInstance) {
    await redisCacheInstance.quit();
    redisCacheInstance = null;
  }
}
