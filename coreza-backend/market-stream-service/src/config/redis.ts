import Redis, { RedisOptions } from "ioredis";

// ========== SENTINEL CONFIGURATION ==========
// Environment variables for Redis Sentinel high-availability:
// REDIS_SENTINEL_HOSTS: Comma-separated list of sentinel hosts (e.g., "sentinel1:26379,sentinel2:26379,sentinel3:26379")
// REDIS_SENTINEL_MASTER_QUEUE: Master name for queue Redis (default: "mymaster-queue")
// REDIS_SENTINEL_MASTER_CACHE: Master name for cache Redis (default: "mymaster-cache")
// REDIS_SENTINEL_PASSWORD: Password for sentinel authentication (optional)
// REDIS_PASSWORD: Password for Redis master authentication (optional)

interface SentinelConfig {
  enabled: boolean;
  sentinels: Array<{ host: string; port: number }>;
  masterName: string;
  sentinelPassword?: string;
  password?: string;
}

function parseSentinelConfig(masterEnvVar: string): SentinelConfig {
  const sentinelHosts = process.env.REDIS_SENTINEL_HOSTS;

  if (!sentinelHosts) {
    return { enabled: false, sentinels: [], masterName: "" };
  }

  const sentinels = sentinelHosts.split(",").map((host) => {
    const [hostname, port] = host.trim().split(":");
    return { host: hostname, port: parseInt(port, 10) || 26379 };
  });

  const masterName =
    process.env[masterEnvVar] ||
    (masterEnvVar === "REDIS_SENTINEL_MASTER_QUEUE"
      ? "mymaster-queue"
      : "mymaster-cache");

  return {
    enabled: true,
    sentinels,
    masterName,
    sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD,
    password: process.env.REDIS_PASSWORD,
  };
}

// ========== PRODUCTION REDIS OPTIONS ==========
const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  family: 4, // Force IPv4 to prevent localhost resolution issues
  keepAlive: 30000, // Keep connections alive
  retryStrategy: (times: number) => {
    // Exponential backoff with max 30 seconds
    const delay = Math.min(times * 100, 30000);
    console.log(`[Redis] Retry attempt ${times}, next retry in ${delay}ms`);
    return delay;
  },
};

// Queue Redis: Optimized for latency-critical BullMQ and Pub/Sub operations
const queueOptions: RedisOptions = {
  ...baseOptions,
  enableReadyCheck: false, // BullMQ requirement
  connectTimeout: 10000, // 10s connect timeout
  lazyConnect: false, // Connect immediately
};

// Cache Redis: Optimized for medium-latency caching operations
const cacheOptions: RedisOptions = {
  ...baseOptions,
  enableReadyCheck: true, // Verify connection before use
  connectTimeout: 15000, // 15s connect timeout (more tolerance)
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

const getRedisOrThrow = (
  resolveResult: { url: string | undefined; hasTlsFlag: boolean },
  usage: string,
): { redisUrl: string; hasTlsFlag: boolean } => {
  if (!resolveResult.url) {
    throw new Error(
      `Redis URL is required for ${usage}. Set REDIS_URL or the dedicated environment variable.`,
    );
  }

  return { redisUrl: resolveResult.url, hasTlsFlag: resolveResult.hasTlsFlag };
};

// ========== QUEUE REDIS (Latency-Critical) ==========
let redisQueueInstance: Redis | null = null;
let redisQueuePubInstance: Redis | null = null;
let redisQueueSubInstance: Redis | null = null;

// ========== CACHE REDIS (Medium-Latency) ==========
let redisCacheInstance: Redis | null = null;

// Legacy export for backward compatibility
export const connectionOptions: RedisOptions = {
  ...baseOptions,
};

// Build options for Queue Redis (latency-critical)
const buildQueueOptions = (
  redisUrl: string | undefined,
  hasTlsFlag: boolean,
): RedisOptions => {
  const shouldUseTls =
    process.env.REDIS_TLS === "true" ||
    hasTlsFlag ||
    (redisUrl?.startsWith("rediss://") ?? false);

  return {
    ...queueOptions,
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

// Build options for Cache Redis (medium-latency)
const buildCacheOptions = (
  redisUrl: string | undefined,
  hasTlsFlag: boolean,
): RedisOptions => {
  const shouldUseTls =
    process.env.REDIS_TLS === "true" ||
    hasTlsFlag ||
    (redisUrl?.startsWith("rediss://") ?? false);

  return {
    ...cacheOptions,
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

// Build Sentinel options for high-availability
const buildSentinelOptions = (
  sentinelConfig: SentinelConfig,
  baseRedisOptions: RedisOptions,
): RedisOptions => {
  const shouldUseTls = process.env.REDIS_TLS === "true";

  return {
    ...baseRedisOptions,
    sentinels: sentinelConfig.sentinels,
    name: sentinelConfig.masterName,
    sentinelPassword: sentinelConfig.sentinelPassword,
    password: sentinelConfig.password,
    // Sentinel-specific options
    sentinelRetryStrategy: (times: number) => {
      const delay = Math.min(times * 100, 10000);
      console.log(
        `[Redis Sentinel] Retry attempt ${times}, next retry in ${delay}ms`,
      );
      return delay;
    },
    failoverDetector: true, // Automatically detect failover
    ...(shouldUseTls
      ? {
          tls: {
            rejectUnauthorized:
              process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== "false",
          },
          enableTLSForSentinelMode: true,
        }
      : {}),
  };
};

// Create Redis instance with Sentinel or standalone mode
function createRedisInstance(
  usage: "queue" | "cache",
  logContext: string,
): Redis {
  const sentinelMasterEnv =
    usage === "queue"
      ? "REDIS_SENTINEL_MASTER_QUEUE"
      : "REDIS_SENTINEL_MASTER_CACHE";

  const sentinelConfig = parseSentinelConfig(sentinelMasterEnv);

  if (sentinelConfig.enabled) {
    const baseOpts = usage === "queue" ? queueOptions : cacheOptions;
    const options = buildSentinelOptions(sentinelConfig, baseOpts);

    const redis = new Redis(options);

    // Add Sentinel event handlers
    redis.on("connect", () => {
      console.log(`[Redis Sentinel] ${logContext} connected to master`);
    });
    redis.on("+switch-master", (data) => {
      console.log(
        `[Redis Sentinel] ${logContext} failover detected, switching to new master:`,
        data,
      );
    });
    redis.on("error", (err) => {
      console.error(`[Redis Sentinel] ${logContext} error:`, err.message);
    });
    redis.on("reconnecting", () => {
      console.log(`[Redis Sentinel] ${logContext} reconnecting...`);
    });

    console.log(
      `[Redis Sentinel] ${logContext} initialized with ${sentinelConfig.sentinels.length} sentinels, master: ${sentinelConfig.masterName}`,
    );
    return redis;
  }

  // Fallback to standalone Redis
  const primaryEnvVar =
    usage === "queue" ? "REDIS_QUEUE_URL" : "REDIS_CACHE_URL";
  const resolved = resolveRedisConfig(primaryEnvVar);
  const { redisUrl, hasTlsFlag } = getRedisOrThrow(resolved, logContext);
  const options =
    usage === "queue"
      ? buildQueueOptions(redisUrl, hasTlsFlag)
      : buildCacheOptions(redisUrl, hasTlsFlag);

  const redis = new Redis(redisUrl, options);

  // Add connection event handlers
  redis.on("connect", () => {
    console.log(`[Redis] ${logContext} connected`);
  });
  redis.on("error", (err) => {
    console.error(`[Redis] ${logContext} error:`, err.message);
  });
  redis.on("reconnecting", () => {
    console.log(`[Redis] ${logContext} reconnecting...`);
  });

  console.log(
    `[Redis] ${logContext} connection established (source: ${resolved.sourceEnv})`,
  );
  return redis;
}

/**
 * Get Redis for BullMQ queues + Pub/Sub (latency-critical)
 * Supports Sentinel for HA or standalone mode with REDIS_QUEUE_URL fallback to REDIS_URL
 */
export function getRedisQueue(): Redis {
  if (redisQueueInstance) return redisQueueInstance;
  redisQueueInstance = createRedisInstance("queue", "Queue");
  return redisQueueInstance;
}

/**
 * Get Redis Pub/Sub for market data streaming (latency-critical)
 * Supports Sentinel for HA or standalone mode
 */
export function getRedisPubSub(): { pub: Redis; sub: Redis } {
  if (redisQueuePubInstance && redisQueueSubInstance) {
    return { pub: redisQueuePubInstance, sub: redisQueueSubInstance };
  }

  redisQueuePubInstance = createRedisInstance("queue", "Queue Pub");
  redisQueueSubInstance = createRedisInstance("queue", "Queue Sub");

  return { pub: redisQueuePubInstance, sub: redisQueueSubInstance };
}

/**
 * Create NEW Redis connections for Pub/Sub (not singletons)
 * Use this when services need isolated subscriber connections
 * Supports Sentinel for HA or standalone mode
 */
export function createRedisPubSub(): { pub: Redis; sub: Redis } {
  return {
    pub: createRedisInstance("queue", "Queue Pub (new)"),
    sub: createRedisInstance("queue", "Queue Sub (new)"),
  };
}

/**
 * Get Redis for caching (credentials, state, subscriptions)
 * Supports Sentinel for HA or standalone mode with REDIS_CACHE_URL fallback to REDIS_URL
 */
export function getRedisCache(): Redis {
  if (redisCacheInstance) return redisCacheInstance;
  redisCacheInstance = createRedisInstance("cache", "Cache");
  return redisCacheInstance;
}

/**
 * Check if Sentinel mode is enabled
 */
export function isSentinelEnabled(): boolean {
  return !!process.env.REDIS_SENTINEL_HOSTS;
}

/**
 * Get current Redis mode configuration info
 */
export function getRedisConfigInfo(): {
  mode: "sentinel" | "standalone";
  queue: { source: string; masterName?: string };
  cache: { source: string; masterName?: string };
} {
  const sentinelEnabled = isSentinelEnabled();

  if (sentinelEnabled) {
    const queueConfig = parseSentinelConfig("REDIS_SENTINEL_MASTER_QUEUE");
    const cacheConfig = parseSentinelConfig("REDIS_SENTINEL_MASTER_CACHE");

    return {
      mode: "sentinel",
      queue: { source: "sentinel", masterName: queueConfig.masterName },
      cache: { source: "sentinel", masterName: cacheConfig.masterName },
    };
  }

  const queueResolved = resolveRedisConfig("REDIS_QUEUE_URL");
  const cacheResolved = resolveRedisConfig("REDIS_CACHE_URL");

  return {
    mode: "standalone",
    queue: { source: queueResolved.sourceEnv },
    cache: { source: cacheResolved.sourceEnv },
  };
}

export async function closeRedis(): Promise<void> {
  const closePromises: Promise<void>[] = [];

  if (redisQueueInstance) {
    closePromises.push(
      redisQueueInstance.quit().then(() => {
        redisQueueInstance = null;
        console.log("[Redis] Queue connection closed");
      }),
    );
  }
  if (redisQueuePubInstance) {
    closePromises.push(
      redisQueuePubInstance.quit().then(() => {
        redisQueuePubInstance = null;
        console.log("[Redis] Queue Pub connection closed");
      }),
    );
  }
  if (redisQueueSubInstance) {
    closePromises.push(
      redisQueueSubInstance.quit().then(() => {
        redisQueueSubInstance = null;
        console.log("[Redis] Queue Sub connection closed");
      }),
    );
  }
  if (redisCacheInstance) {
    closePromises.push(
      redisCacheInstance.quit().then(() => {
        redisCacheInstance = null;
        console.log("[Redis] Cache connection closed");
      }),
    );
  }

  await Promise.all(closePromises);
}
