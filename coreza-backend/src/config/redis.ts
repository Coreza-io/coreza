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

let redisInstance: Redis | null = null;
let redisPubInstance: Redis | null = null;
let redisSubInstance: Redis | null = null;

export const connectionOptions: RedisOptions = {
  ...baseOptions,
};

/**
 * Get shared Redis connection for BullMQ and general use
 */
export function getRedis(): Redis {
  if (redisInstance) return redisInstance;

  const { url: redisUrl, hasTlsFlag } = normalizeRedisInput(
    process.env.REDIS_URL,
  );

  if (!redisUrl) {
    throw new Error("REDIS_URL is required for BullMQ queue");
  }

  const shouldUseTls =
    process.env.REDIS_TLS === "true" ||
    hasTlsFlag ||
    (redisUrl?.startsWith("rediss://") ?? false);

  const options: RedisOptions = {
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

  redisInstance = redisUrl
    ? new Redis(redisUrl, options)
    : new Redis({
        host: "localhost",
        port: parseInt("6379", 10),
        ...baseOptions,
      });

  return redisInstance;
}

/**
 * Get dedicated Redis connections for Pub/Sub
 * Pub/Sub requires separate connections (one for subscribe, one for publish)
 */
export function getRedisPubSub(): { pub: Redis; sub: Redis } {
  if (redisPubInstance && redisSubInstance) {
    return { pub: redisPubInstance, sub: redisSubInstance };
  }

  const { url: redisUrl, hasTlsFlag } = normalizeRedisInput(
    process.env.REDIS_URL,
  );

  if (!redisUrl) {
    throw new Error("REDIS_URL is required for Pub/Sub");
  }

  const shouldUseTls =
    process.env.REDIS_TLS === "true" ||
    hasTlsFlag ||
    (redisUrl?.startsWith("rediss://") ?? false);

  const options: RedisOptions = {
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

  // Create separate connections for pub and sub
  redisPubInstance = new Redis(redisUrl, options);
  redisSubInstance = new Redis(redisUrl, options);

  return { pub: redisPubInstance, sub: redisSubInstance };
}

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
  if (redisPubInstance) {
    await redisPubInstance.quit();
    redisPubInstance = null;
  }
  if (redisSubInstance) {
    await redisSubInstance.quit();
    redisSubInstance = null;
  }
}
