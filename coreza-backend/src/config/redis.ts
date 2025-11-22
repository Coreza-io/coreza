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

const { url: redisUrl, hasTlsFlag } = normalizeRedisInput(
  process.env.REDIS_URL,
);

const shouldUseTls =
  process.env.REDIS_TLS === "true" ||
  hasTlsFlag ||
  (redisUrl?.startsWith("rediss://") ?? false);

const connectionOptions: RedisOptions = {
  ...baseOptions,
  ...(shouldUseTls
    ? {
        tls: {
          rejectUnauthorized:
            process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== "false",
        },
      }
    : {}),
};

const redis = redisUrl
  ? new Redis(redisUrl, connectionOptions)
  : new Redis({
      host: "localhost",
      port: parseInt("6379", 10),
      ...baseOptions,
    });

export { redis };
