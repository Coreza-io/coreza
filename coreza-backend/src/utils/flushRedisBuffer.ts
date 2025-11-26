import { getRedis } from '../config/redis';
import { RedisBuffer } from '../services/RedisBuffer';
import { redisPublishBreaker } from './redisCircuitBreaker';

/**
 * Setup automatic buffer flush when Redis circuit closes
 * This ensures buffered messages are published when Redis connection is restored
 */
export function setupBufferFlush(): void {
  redisPublishBreaker.on('close', async () => {
    console.log('🟢 [CircuitBreaker] Redis PUBLISH circuit restored, flushing buffer...');
    
    try {
      const redis = getRedis();
      const flushed = await RedisBuffer.getInstance().flushToRedis(redis);
      
      if (flushed > 0) {
        console.log(`✅ [CircuitBreaker] Successfully flushed ${flushed} buffered messages to Redis`);
      }
    } catch (error) {
      console.error('❌ [CircuitBreaker] Failed to flush buffer after circuit close:', error);
    }
  });
}
