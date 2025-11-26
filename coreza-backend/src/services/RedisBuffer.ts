import Redis from 'ioredis';
import { createLogger } from '../utils/logger';
import { redisBufferSizeGauge } from '../utils/metrics';
import { alertBufferOverflow } from '../utils/alerting';

const logger = createLogger('RedisBuffer');

interface BufferedMessage {
  channel: string;
  message: string;
  timestamp: number;
}

/**
 * RedisBuffer - In-memory buffer for Redis messages during outages
 * 
 * Buffers messages when Redis is unavailable and flushes them when connection is restored.
 * Prevents message loss during Redis circuit breaker trips.
 */
export class RedisBuffer {
  private static instance: RedisBuffer;
  private buffer: BufferedMessage[] = [];
  private readonly MAX_BUFFER_SIZE = 10000;
  private readonly MAX_AGE_MS = 60000; // 1 minute

  private constructor() {}

  static getInstance(): RedisBuffer {
    if (!RedisBuffer.instance) {
      RedisBuffer.instance = new RedisBuffer();
    }
    return RedisBuffer.instance;
  }

  /**
   * Buffer a message when Redis is unavailable
   */
  bufferMessage(channel: string, message: string): void {
    // Alert if buffer approaching capacity (80%)
    if (this.buffer.length >= this.MAX_BUFFER_SIZE * 0.8) {
      alertBufferOverflow();
    }

    // Remove oldest messages if buffer is full
    if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
      const removed = this.buffer.shift();
      logger.warn({ channel: removed?.channel, bufferSize: this.buffer.length }, 'Buffer full, dropped oldest message');
    }

    this.buffer.push({
      channel,
      message,
      timestamp: Date.now(),
    });

    redisBufferSizeGauge.set(this.buffer.length);
    logger.debug({ channel, bufferSize: this.buffer.length, maxSize: this.MAX_BUFFER_SIZE }, 'Message buffered');
  }

  /**
   * Attempt to flush buffered messages to Redis
   * Returns number of messages successfully flushed
   */
  async flushToRedis(redis: Redis): Promise<number> {
    if (this.buffer.length === 0) return 0;

    const startSize = this.buffer.length;
    logger.info({ startSize }, 'Starting buffer flush');

    let flushed = 0;
    const now = Date.now();
    const errors: Error[] = [];

    while (this.buffer.length > 0) {
      const msg = this.buffer[0];

      // Skip messages older than MAX_AGE
      if (now - msg.timestamp > this.MAX_AGE_MS) {
        this.buffer.shift();
        logger.warn({ channel: msg.channel, age: now - msg.timestamp }, 'Skipped expired message');
        continue;
      }

      try {
        await redis.publish(msg.channel, msg.message);
        this.buffer.shift();
        flushed++;
      } catch (error) {
        // Redis still unavailable, stop flushing
        errors.push(error as Error);
        break;
      }
    }

    if (flushed > 0) {
      redisBufferSizeGauge.set(this.buffer.length);
      logger.info({ flushed, remaining: this.buffer.length }, 'Buffer flush completed');
    }

    if (errors.length > 0) {
      logger.error({ error: errors[0], flushed, remaining: this.buffer.length }, 'Buffer flush incomplete');
    }

    return flushed;
  }

  /**
   * Get buffer statistics
   */
  getStats() {
    const now = Date.now();
    const oldestMessage = this.buffer[0];

    return {
      bufferedMessages: this.buffer.length,
      maxSize: this.MAX_BUFFER_SIZE,
      oldestMessageAge: oldestMessage ? now - oldestMessage.timestamp : null,
      utilizationPercent: (this.buffer.length / this.MAX_BUFFER_SIZE) * 100,
    };
  }

  /**
   * Clear all buffered messages (for testing/emergency)
   */
  clear(): void {
    const count = this.buffer.length;
    this.buffer = [];
    redisBufferSizeGauge.set(0);
    logger.warn({ clearedCount: count }, 'Buffer cleared');
  }
}

export default RedisBuffer;
