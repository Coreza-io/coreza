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

import { getRedisCache } from '../config/redis';
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
