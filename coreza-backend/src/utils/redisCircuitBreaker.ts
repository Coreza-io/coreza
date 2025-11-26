import CircuitBreaker from 'opossum';
import { getRedis } from '../config/redis';

const circuitBreakerOptions = {
  timeout: 5000,                    // 5 second timeout for operations
  errorThresholdPercentage: 50,     // Open circuit at 50% failures
  resetTimeout: 30000,              // Try again after 30 seconds
  volumeThreshold: 5,               // Min requests before circuit can open
};

/**
 * Circuit breaker for Redis PUBLISH operations
 * Prevents cascading failures when Redis is unavailable
 */
export const redisPublishBreaker = new CircuitBreaker(
  async (channel: string, message: string) => {
    const redis = getRedis();
    return redis.publish(channel, message);
  },
  circuitBreakerOptions
);

/**
 * Circuit breaker for Redis GET operations
 */
export const redisGetBreaker = new CircuitBreaker(
  async (key: string) => {
    const redis = getRedis();
    return redis.get(key);
  },
  circuitBreakerOptions
);

/**
 * Circuit breaker for Redis SET operations
 */
export const redisSetBreaker = new CircuitBreaker(
  async (key: string, value: string) => {
    const redis = getRedis();
    return redis.set(key, value);
  },
  circuitBreakerOptions
);

// Event handlers for monitoring
redisPublishBreaker.on('open', () => {
  console.error('🔴 [CircuitBreaker] Redis PUBLISH circuit OPEN - fallback active');
});

redisPublishBreaker.on('halfOpen', () => {
  console.warn('🟡 [CircuitBreaker] Redis PUBLISH circuit HALF-OPEN - testing connection');
});

redisPublishBreaker.on('close', () => {
  console.log('🟢 [CircuitBreaker] Redis PUBLISH circuit CLOSED - normal operation');
});

redisGetBreaker.on('open', () => {
  console.error('🔴 [CircuitBreaker] Redis GET circuit OPEN - fallback active');
});

redisGetBreaker.on('halfOpen', () => {
  console.warn('🟡 [CircuitBreaker] Redis GET circuit HALF-OPEN - testing connection');
});

redisGetBreaker.on('close', () => {
  console.log('🟢 [CircuitBreaker] Redis GET circuit CLOSED - normal operation');
});

redisSetBreaker.on('open', () => {
  console.error('🔴 [CircuitBreaker] Redis SET circuit OPEN - fallback active');
});

redisSetBreaker.on('halfOpen', () => {
  console.warn('🟡 [CircuitBreaker] Redis SET circuit HALF-OPEN - testing connection');
});

redisSetBreaker.on('close', () => {
  console.log('🟢 [CircuitBreaker] Redis SET circuit CLOSED - normal operation');
});
