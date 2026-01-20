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

import CircuitBreaker from "opossum";
import { createLogger } from "./logger";

const logger = createLogger("RedisCircuitBreaker");

/**
 * Circuit breaker configuration optimized for Redis operations
 * - Short timeout for fast-fail on slow Redis
 * - Lower threshold for test listener operations (high volume, fast recovery preferred)
 */
const circuitBreakerOptions = {
  timeout: 3000, // 3 second timeout for operations
  errorThresholdPercentage: 50, // Open circuit at 50% failures
  resetTimeout: 15000, // Try again after 15 seconds
  volumeThreshold: 10, // Min requests before circuit can open
};

/**
 * Track circuit breaker state changes
 */
function setupCircuitBreakerEvents(
  breaker: CircuitBreaker,
  name: string,
): void {
  breaker.on("open", () => {
    logger.error(
      { breaker: name, state: "OPEN" },
      `${name} circuit OPEN - operations will fail fast`,
    );
  });

  breaker.on("halfOpen", () => {
    logger.warn(
      { breaker: name, state: "HALF_OPEN" },
      `${name} circuit HALF-OPEN - testing connection`,
    );
  });

  breaker.on("close", () => {
    logger.info(
      { breaker: name, state: "CLOSED" },
      `${name} circuit CLOSED - normal operation resumed`,
    );
  });

  breaker.on("fallback", () => {
    logger.debug({ breaker: name }, `${name} fallback executed`);
  });
}

/**
 * Circuit breaker for Redis PUBLISH operations
 * Used by flushRedisBuffer to detect when Redis is restored
 */
export const redisPublishBreaker = new CircuitBreaker(
  async (redis: any, channel: string, message: string) => {
    return redis.publish(channel, message);
  },
  circuitBreakerOptions,
);

/**
 * Circuit breaker for Redis SMEMBERS operation (test listeners)
 */
export const redisSMembersBreaker = new CircuitBreaker(
  async (redis: any, key: string) => {
    return redis.smembers(key);
  },
  {
    ...circuitBreakerOptions,
    // Return empty array on failure - safe fallback for test listeners
    fallback: () => [],
  },
);

/**
 * Circuit breaker for Redis GET operation
 */
export const redisGetBreaker = new CircuitBreaker(
  async (redis: any, key: string) => {
    return redis.get(key);
  },
  {
    ...circuitBreakerOptions,
    // Return null on failure - caller should handle null gracefully
    fallback: () => null,
  },
);

/**
 * Circuit breaker for Redis SET operation
 */
export const redisSetBreaker = new CircuitBreaker(
  async (redis: any, key: string, value: string) => {
    return redis.set(key, value);
  },
  {
    ...circuitBreakerOptions,
    // Return null on failure - caller should handle null gracefully
    fallback: () => null,
  },
);

/**
 * Circuit breaker for Redis EVAL (Lua script) operations
 */
export const redisEvalBreaker = new CircuitBreaker(
  async (redis: any, script: string, numKeys: number, ...args: any[]) => {
    return redis.eval(script, numKeys, ...args);
  },
  {
    ...circuitBreakerOptions,
    timeout: 5000, // Slightly longer timeout for Lua scripts
    // Return null on failure - indicates operation didn't complete
    fallback: () => null,
  },
);

/**
 * Circuit breaker for Redis SREM operation
 */
export const redisSRemBreaker = new CircuitBreaker(
  async (redis: any, key: string, member: string) => {
    return redis.srem(key, member);
  },
  {
    ...circuitBreakerOptions,
    // Return 0 on failure - indicates no members removed
    fallback: () => 0,
  },
);

// Setup event handlers for all breakers
setupCircuitBreakerEvents(redisPublishBreaker, "redisPublish");
setupCircuitBreakerEvents(redisSMembersBreaker, "redisSMembers");
setupCircuitBreakerEvents(redisGetBreaker, "redisGet");
setupCircuitBreakerEvents(redisSetBreaker, "redisSet");
setupCircuitBreakerEvents(redisEvalBreaker, "redisEval");
setupCircuitBreakerEvents(redisSRemBreaker, "redisSRem");

/**
 * Get combined circuit breaker health status
 */
export function getCircuitBreakerHealth(): {
  publish: { state: string; stats: any };
  smembers: { state: string; stats: any };
  get: { state: string; stats: any };
  set: { state: string; stats: any };
  eval: { state: string; stats: any };
  srem: { state: string; stats: any };
} {
  return {
    publish: {
      state: redisPublishBreaker.opened
        ? "OPEN"
        : redisPublishBreaker.halfOpen
          ? "HALF_OPEN"
          : "CLOSED",
      stats: redisPublishBreaker.stats,
    },
    smembers: {
      state: redisSMembersBreaker.opened
        ? "OPEN"
        : redisSMembersBreaker.halfOpen
          ? "HALF_OPEN"
          : "CLOSED",
      stats: redisSMembersBreaker.stats,
    },
    get: {
      state: redisGetBreaker.opened
        ? "OPEN"
        : redisGetBreaker.halfOpen
          ? "HALF_OPEN"
          : "CLOSED",
      stats: redisGetBreaker.stats,
    },
    set: {
      state: redisSetBreaker.opened
        ? "OPEN"
        : redisSetBreaker.halfOpen
          ? "HALF_OPEN"
          : "CLOSED",
      stats: redisSetBreaker.stats,
    },
    eval: {
      state: redisEvalBreaker.opened
        ? "OPEN"
        : redisEvalBreaker.halfOpen
          ? "HALF_OPEN"
          : "CLOSED",
      stats: redisEvalBreaker.stats,
    },
    srem: {
      state: redisSRemBreaker.opened
        ? "OPEN"
        : redisSRemBreaker.halfOpen
          ? "HALF_OPEN"
          : "CLOSED",
      stats: redisSRemBreaker.stats,
    },
  };
}
