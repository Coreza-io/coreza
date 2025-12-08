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

import Redis, { RedisOptions } from "ioredis";

// ========== PRODUCTION REDIS OPTIONS ==========
const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  family: 4, // Force IPv4 to prevent localhost resolution issues
  keepAlive: 30000, // Keep connections alive
};

// Queue Redis: Optimized for latency-critical BullMQ operations
const queueOptions: RedisOptions = {
  ...baseOptions,
  enableReadyCheck: false, // BullMQ requirement
  connectTimeout: 5000, // Fast connect for queue operations
  commandTimeout: 3000, // Fast timeout for queue commands
  lazyConnect: false, // Connect immediately
};

// Cache Redis: Optimized for medium-latency caching operations
const cacheOptions: RedisOptions = {
  ...baseOptions,
  enableReadyCheck: true, // Verify connection before use
  connectTimeout: 10000, // More tolerance for cache
  commandTimeout: 5000, // More tolerance for cache commands
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

/**
 * Get Redis for BullMQ queues + Pub/Sub (latency-critical)
 * Uses REDIS_QUEUE_URL with fallback to REDIS_URL
 */
export function getRedisQueue(): Redis {
  if (redisQueueInstance) return redisQueueInstance;

  const resolved = resolveRedisConfig("REDIS_QUEUE_URL");
  const { redisUrl, hasTlsFlag } = getRedisOrThrow(resolved, "BullMQ queue and pub/sub operations");

  redisQueueInstance = new Redis(redisUrl, buildQueueOptions(redisUrl, hasTlsFlag));
  console.log(`[Redis] Queue connection established (source: ${resolved.sourceEnv})`);
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
  const options = buildQueueOptions(redisUrl, hasTlsFlag);

  redisQueuePubInstance = new Redis(redisUrl, options);
  redisQueueSubInstance = new Redis(redisUrl, options);

  console.log(`[Redis] Queue Pub/Sub connections established (source: ${resolved.sourceEnv})`);
  return { pub: redisQueuePubInstance, sub: redisQueueSubInstance };
}

/**
 * Create NEW Redis connections for Pub/Sub (not singletons)
 * Use this when services need isolated subscriber connections
 */
export function createRedisQueuePubSub(): { pub: Redis; sub: Redis } {
  const resolved = resolveRedisConfig("REDIS_QUEUE_URL");
  const { redisUrl, hasTlsFlag } = getRedisOrThrow(resolved, "Pub/Sub");
  const options = buildQueueOptions(redisUrl, hasTlsFlag);

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

  redisCacheInstance = new Redis(redisUrl, buildCacheOptions(redisUrl, hasTlsFlag));
  console.log(`[Redis] Cache connection established (source: ${resolved.sourceEnv})`);
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
