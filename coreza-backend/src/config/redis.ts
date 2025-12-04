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

/**
 * Create NEW Redis connections for Pub/Sub (not singletons)
 * Use this when services need isolated subscriber connections
 */
export function createRedisPubSub(): { pub: Redis; sub: Redis } {
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

  // Create NEW connections (not singletons)
  return {
    pub: new Redis(redisUrl, options),
    sub: new Redis(redisUrl, options),
  };
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
