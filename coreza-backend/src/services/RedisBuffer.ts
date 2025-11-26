import Redis from 'ioredis';

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
    // Remove oldest messages if buffer is full
    if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
      const removed = this.buffer.shift();
      console.warn(`⚠️ [RedisBuffer] Buffer full, dropped oldest message from ${removed?.channel}`);
    }

    this.buffer.push({
      channel,
      message,
      timestamp: Date.now(),
    });

    console.log(`📦 [RedisBuffer] Buffered message for ${channel} (${this.buffer.length}/${this.MAX_BUFFER_SIZE})`);
  }

  /**
   * Attempt to flush buffered messages to Redis
   * Returns number of messages successfully flushed
   */
  async flushToRedis(redis: Redis): Promise<number> {
    if (this.buffer.length === 0) return 0;

    console.log(`🔄 [RedisBuffer] Starting flush of ${this.buffer.length} buffered messages...`);

    let flushed = 0;
    const now = Date.now();
    const errors: Error[] = [];

    while (this.buffer.length > 0) {
      const msg = this.buffer[0];

      // Skip messages older than MAX_AGE
      if (now - msg.timestamp > this.MAX_AGE_MS) {
        this.buffer.shift();
        console.warn(`⚠️ [RedisBuffer] Skipped expired message from ${msg.channel}`);
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
      console.log(`✅ [RedisBuffer] Flushed ${flushed} messages to Redis (${this.buffer.length} remaining)`);
    }

    if (errors.length > 0) {
      console.error(`❌ [RedisBuffer] Failed to flush remaining messages:`, errors[0]);
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
    console.log(`🗑️ [RedisBuffer] Cleared ${count} buffered messages`);
  }
}

export default RedisBuffer;
