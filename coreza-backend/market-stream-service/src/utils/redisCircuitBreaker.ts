import CircuitBreaker from "opossum";
import { getRedisPubSub } from "../config/redis";
import { createLogger } from "./logger";
import { alertRedisCircuitOpen } from "./alerting";
import { redisOperationsCounter } from "./metrics";

const logger = createLogger("CircuitBreaker");

const circuitBreakerOptions = {
  timeout: 5000, // 5 second timeout for operations
  errorThresholdPercentage: 50, // Open circuit at 50% failures
  resetTimeout: 30000, // Try again after 30 seconds
  volumeThreshold: 5, // Min requests before circuit can open
};

// Lazy Redis connection initialization to prevent startup crashes
let redisPub: any = null;

function getRedisConnection() {
  if (!redisPub) {
    const { pub } = getRedisPubSub();
    redisPub = pub;
  }
  return redisPub;
}

/**
 * Circuit breaker for Redis PUBLISH operations
 * Prevents cascading failures when Redis is unavailable
 */
export const redisPublishBreaker = new CircuitBreaker(
  async (channel: string, message: string) => {
    return getRedisConnection().publish(channel, message);
  },
  circuitBreakerOptions,
);

/**
 * Circuit breaker for Redis GET operations
 */
export const redisGetBreaker = new CircuitBreaker(async (key: string) => {
  return getRedisConnection().get(key);
}, circuitBreakerOptions);

/**
 * Circuit breaker for Redis SET operations
 */
export const redisSetBreaker = new CircuitBreaker(
  async (key: string, value: string) => {
    return getRedisConnection().set(key, value);
  },
  circuitBreakerOptions,
);

// Event handlers for monitoring
redisPublishBreaker.on("open", () => {
  logger.fatal(
    { breaker: "redisPublish", state: "OPEN" },
    "Redis PUBLISH circuit OPEN - fallback active",
  );
  redisOperationsCounter.inc({ operation: "publish", status: "circuit_open" });
  alertRedisCircuitOpen();
});

redisPublishBreaker.on("halfOpen", () => {
  logger.warn(
    { breaker: "redisPublish", state: "HALF_OPEN" },
    "Redis PUBLISH circuit HALF-OPEN - testing connection",
  );
});

redisPublishBreaker.on("close", () => {
  logger.info(
    { breaker: "redisPublish", state: "CLOSED" },
    "Redis PUBLISH circuit CLOSED - normal operation",
  );
  redisOperationsCounter.inc({
    operation: "publish",
    status: "circuit_closed",
  });
});

redisGetBreaker.on("open", () => {
  logger.fatal(
    { breaker: "redisGet", state: "OPEN" },
    "Redis GET circuit OPEN - fallback active",
  );
  redisOperationsCounter.inc({ operation: "get", status: "circuit_open" });
});

redisGetBreaker.on("halfOpen", () => {
  logger.warn(
    { breaker: "redisGet", state: "HALF_OPEN" },
    "Redis GET circuit HALF-OPEN - testing connection",
  );
});

redisGetBreaker.on("close", () => {
  logger.info(
    { breaker: "redisGet", state: "CLOSED" },
    "Redis GET circuit CLOSED - normal operation",
  );
  redisOperationsCounter.inc({ operation: "get", status: "circuit_closed" });
});

redisSetBreaker.on("open", () => {
  logger.fatal(
    { breaker: "redisSet", state: "OPEN" },
    "Redis SET circuit OPEN - fallback active",
  );
  redisOperationsCounter.inc({ operation: "set", status: "circuit_open" });
});

redisSetBreaker.on("halfOpen", () => {
  logger.warn(
    { breaker: "redisSet", state: "HALF_OPEN" },
    "Redis SET circuit HALF-OPEN - testing connection",
  );
});

redisSetBreaker.on("close", () => {
  logger.info(
    { breaker: "redisSet", state: "CLOSED" },
    "Redis SET circuit CLOSED - normal operation",
  );
  redisOperationsCounter.inc({ operation: "set", status: "circuit_closed" });
});
