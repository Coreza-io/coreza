/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import type { ChainableCommander } from "ioredis";
import { getRedisCache } from "../config/redis";

export const RedisOps = {
  hset: async (key: string, data: Record<string, string>): Promise<void> => {
    await getRedisCache().hset(key, data);
  },

  hget: async (key: string, field: string): Promise<string | null> =>
    getRedisCache().hget(key, field),

  hsetObject: async (key: string, field: string, value: unknown): Promise<void> => {
    await getRedisCache().hset(key, field, JSON.stringify(value ?? null));
  },

  hgetall: async (key: string): Promise<Record<string, string>> =>
    getRedisCache().hgetall(key),

  setJSON: async (key: string, value: unknown, ttlSeconds?: number): Promise<void> => {
    const redis = getRedisCache();
    const serialized = JSON.stringify(value ?? null);
    if (ttlSeconds && ttlSeconds > 0) {
      await redis.set(key, serialized, "EX", ttlSeconds);
      return;
    }
    await redis.set(key, serialized);
  },

  getJSON: async <T = unknown>(key: string): Promise<T | null> => {
    const raw = await getRedisCache().get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  },

  sadd: async (key: string, ...members: string[]): Promise<number> =>
    members.length ? getRedisCache().sadd(key, ...members) : 0,

  srem: async (key: string, ...members: string[]): Promise<number> =>
    members.length ? getRedisCache().srem(key, ...members) : 0,

  smembers: async (key: string): Promise<string[]> => getRedisCache().smembers(key),

  del: async (...keys: string[]): Promise<number> =>
    keys.length ? getRedisCache().del(...keys) : 0,

  expire: async (key: string, ttlSeconds: number): Promise<number> =>
    getRedisCache().expire(key, ttlSeconds),

  exists: async (key: string): Promise<number> => getRedisCache().exists(key),

  pipeline: (): ChainableCommander => getRedisCache().pipeline(),
};
