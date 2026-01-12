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

import Redis from "ioredis";
import CredentialManager from "../../../utils/credentialManager";
import logger from "../../../utils/logger";

// Cache for user Redis connections (reuse connections per user+credential)
const userRedisConnections = new Map<string, Redis>();

/**
 * Get or create a user's Redis connection
 */
export async function getUserRedisConnection(
  userId: string,
  credentialId: string,
  credentials?: any
): Promise<Redis> {
  const cacheKey = `${userId}:${credentialId}`;

  // Return cached connection if exists and ready
  if (userRedisConnections.has(cacheKey)) {
    const redis = userRedisConnections.get(cacheKey)!;
    if (redis.status === "ready" || redis.status === "connecting") {
      return redis;
    }
    // Remove stale connection
    userRedisConnections.delete(cacheKey);
  }

  // Get credentials if not provided
  const creds = credentials?.client_json ||
    (await CredentialManager.getCredentials(userId, "redis", credentialId))?.credentials?.client_json;

  if (!creds?.host) {
    throw new Error("Invalid Redis credentials - host is required");
  }

  // Resolve localhost to 127.0.0.1 to avoid IPv6 issues on Windows
  const host = creds.host === "localhost" ? "127.0.0.1" : creds.host;

  // Create new Redis connection with user's credentials
  const redis = new Redis({
    host,
    port: parseInt(creds.port || "6379", 10),
    password: creds.password || undefined,
    username: creds.user || undefined,
    db: parseInt(creds.database || "0", 10),
    tls: creds.tls === "true" ? { rejectUnauthorized: false } : undefined,
    maxRetriesPerRequest: 3,
    connectTimeout: 10000,
    lazyConnect: true,
    retryStrategy: () => null, // Don't retry on failure
    family: 4, // Force IPv4
  });

  // Attach listeners BEFORE connecting
  const connectionPromise = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Redis connection timeout"));
    }, 10000);

    redis.once("ready", () => {
      clearTimeout(timeout);
      resolve();
    });

    redis.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // NOW connect (after listeners are attached)
  await redis.connect();

  // Wait for connection
  await connectionPromise;

  userRedisConnections.set(cacheKey, redis);
  logger.info(
    { userId, credentialId, host: creds.host },
    "User Redis connection established"
  );
  return redis;
}

/**
 * Test Redis connection before saving credentials
 */
export async function testRedisConnection(
  creds: any
): Promise<{ success: boolean; error?: string }> {
  let testRedis: Redis | null = null;
  try {
    // Resolve localhost to 127.0.0.1 to avoid IPv6 issues on Windows
    const host = creds.host === "localhost" ? "127.0.0.1" : creds.host;

    testRedis = new Redis({
      host,
      port: parseInt(creds.port || "6379", 10),
      password: creds.password || undefined,
      username: creds.user || undefined,
      db: parseInt(creds.database || "0", 10),
      tls: creds.tls === "true" ? { rejectUnauthorized: false } : undefined,
      connectTimeout: 5000,
      retryStrategy: () => null,
      family: 4,
      enableReadyCheck: true,
    });

    // Attach listeners BEFORE connecting
    const connectionPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 5000);

      testRedis!.once("ready", () => {
        clearTimeout(timeout);
        resolve();
      });

      testRedis!.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Wait for connection
    await connectionPromise;

    // Test PING
    const pong = await testRedis.ping();
    if (pong !== "PONG") {
      throw new Error("PING test failed");
    }

    return { success: true };
  } catch (error) {
    logger.error(
      { err: error, host: creds.host },
      "Redis connection test failed"
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (testRedis) {
      try {
        await testRedis.quit();
      } catch {
        testRedis.disconnect();
      }
    }
  }
}

/**
 * Close a user's Redis connection
 */
export function closeUserRedisConnection(userId: string, credentialId: string): void {
  const cacheKey = `${userId}:${credentialId}`;
  const redis = userRedisConnections.get(cacheKey);
  if (redis) {
    redis.disconnect();
    userRedisConnections.delete(cacheKey);
    logger.info({ userId, credentialId }, "User Redis connection closed");
  }
}

/**
 * Close all cached Redis connections (for graceful shutdown)
 */
export function closeAllRedisConnections(): void {
  for (const [key, redis] of userRedisConnections) {
    try {
      redis.disconnect();
    } catch (error) {
      logger.error({ key, err: error }, "Error closing Redis connection");
    }
  }
  userRedisConnections.clear();
  logger.info("All user Redis connections closed");
}
