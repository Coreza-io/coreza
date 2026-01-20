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

/**
 * ============================================
 * STREAMING CONFIGURATION
 * ============================================
 * Centralized configuration for all streaming-related constants.
 * Environment variables can override defaults for production tuning.
 */

// ============================================
// WEBSOCKET CONNECTION LIMITS
// ============================================

/** Maximum WebSocket connections per user (prevents resource exhaustion) */
export const MAX_CONNECTIONS_PER_USER = parseInt(
  process.env.WS_MAX_CONNECTIONS_PER_USER || "10",
  10,
);

/** WebSocket heartbeat interval in milliseconds */
export const WS_HEARTBEAT_INTERVAL_MS = parseInt(
  process.env.WS_HEARTBEAT_INTERVAL_MS || "30000",
  10,
);

// ============================================
// TEST LISTENER LIMITS
// ============================================

/** Maximum concurrent test listeners per user */
export const MAX_LISTENERS_PER_USER = parseInt(
  process.env.MAX_LISTENERS_PER_USER || "5",
  10,
);

/** Test listener TTL in seconds (auto-expire) */
export const LISTENER_TTL_SECONDS = parseInt(
  process.env.LISTENER_TTL_SECONDS || "300",
  10,
);

// ============================================
// POLLING CONFIGURATION
// ============================================

/** Default polling interval for frontend in milliseconds */
export const DEFAULT_POLL_INTERVAL_MS = parseInt(
  process.env.DEFAULT_POLL_INTERVAL_MS || "1000",
  10,
);

/** Polling jitter range in milliseconds (prevents thundering herd) */
export const POLL_JITTER_MS = parseInt(process.env.POLL_JITTER_MS || "200", 10);

/** Test listener key TTL check interval */
export const LISTENER_CLEANUP_INTERVAL_MS = parseInt(
  process.env.LISTENER_CLEANUP_INTERVAL_MS || "60000",
  10,
);

// ============================================
// REDIS KEY HELPER FUNCTIONS
// ============================================

/**
 * Get the Redis key for a user's active test listeners SET.
 * Pattern: user:${userId}:stream:active_listeners
 */
export const getUserTestListenersKey = (userId: string): string =>
  `user:${userId}:stream:active_listeners`;

/**
 * Get the Redis key for a user's test listener count.
 * Pattern: user:${userId}:stream:listener_count
 */
export const getUserTestCountKey = (userId: string): string =>
  `user:${userId}:stream:listener_count`;

/**
 * Get the Redis key for a specific test listener.
 * Pattern: user:${userId}:stream:${workflowId}:${nodeId}
 */
export const getTestListenerKey = (
  userId: string,
  workflowId: string,
  nodeId: string,
): string => `user:${userId}:stream:${workflowId}:${nodeId}`;

// ============================================
// LUA SCRIPTS
// ============================================

/**
 * Lua script for atomic test listener check and delete
 * Prevents race conditions when multiple events arrive simultaneously
 *
 * KEYS[1]: test listener key (stream:test:{workflow_id}:{node_id})
 * KEYS[2]: active test listeners SET key
 * KEYS[3]: result key (stream:test:{workflow_id}:{node_id}:result)
 * ARGV[1]: userId to match
 * ARGV[2]: result JSON string
 * ARGV[3]: result TTL in seconds
 *
 * Returns: listener JSON if found and matches, nil otherwise
 */
export const LUA_ATOMIC_LISTENER = `
  local listenerStr = redis.call('GET', KEYS[1])
  if not listenerStr then
    return nil
  end
  
  local listener = cjson.decode(listenerStr)
  if listener.userId ~= ARGV[1] then
    return nil
  end
  
  if listener.status ~= 'listening' then
    return nil
  end
  
  -- Match found: store result, delete listener, remove from SET
  redis.call('SETEX', KEYS[3], ARGV[3], ARGV[2])
  redis.call('DEL', KEYS[1])
  redis.call('SREM', KEYS[2], KEYS[1])
  
  return listenerStr
`;

/**
 * Lua script for incrementing user test listener count with limit check
 *
 * KEYS[1]: user test count key
 * ARGV[1]: max allowed listeners
 * ARGV[2]: TTL for the count key in seconds
 *
 * Returns: 1 if allowed (incremented), 0 if limit reached
 */
export const LUA_INCREMENT_LISTENER_COUNT = `
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  local max = tonumber(ARGV[1])
  
  if current >= max then
    return 0
  end
  
  redis.call('INCR', KEYS[1])
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  return 1
`;

/**
 * Lua script for decrementing user test listener count
 *
 * KEYS[1]: user test count key
 *
 * Returns: new count
 */
export const LUA_DECREMENT_LISTENER_COUNT = `
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  if current > 0 then
    return redis.call('DECR', KEYS[1])
  end
  return 0
`;
