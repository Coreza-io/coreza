/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { getRedisCache } from '../config/redis';
import { RedisBuffer } from '../infra/RedisBuffer';
import { redisPublishBreaker } from './redisCircuitBreaker';

/**
 * Setup automatic buffer flush when Redis circuit closes
 * This ensures buffered messages are published when Redis connection is restored
 */
export function setupBufferFlush(): void {
  redisPublishBreaker.on('close', async () => {
    console.log('🟢 [CircuitBreaker] Redis PUBLISH circuit restored, flushing buffer...');
    
    try {
      const redis = getRedisCache();
      const flushed = await RedisBuffer.getInstance().flushToRedis(redis);
      
      if (flushed > 0) {
        console.log(`✅ [CircuitBreaker] Successfully flushed ${flushed} buffered messages to Redis`);
      }
    } catch (error) {
      console.error('❌ [CircuitBreaker] Failed to flush buffer after circuit close:', error);
    }
  });
}
