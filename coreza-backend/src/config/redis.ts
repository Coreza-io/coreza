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

export const connectionOptions: RedisOptions = {
  ...baseOptions,
};

export function getRedis(): Redis {
  if (redisInstance) return redisInstance;

  const { url: redisUrl, hasTlsFlag } = normalizeRedisInput(
    process.env.REDIS_URL,
  );

  if (!redisUrl && process.env.USE_BULLMQ_QUEUE === "true") {
    throw new Error("REDIS_URL is required when USE_BULLMQ_QUEUE=true");
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

export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
  }
}
