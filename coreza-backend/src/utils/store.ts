/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import type { Redis } from "ioredis";
import { RedisKeys } from "../infra/redisKeys";

export function buildStoreKey(
  userId: string,
  workflowId: string,
  variableName: string,
): string {
  return RedisKeys.store(userId, workflowId, variableName);
}

export function parseStoredValue(raw: string | null): unknown {
  if (raw === null) return null;

  try {
    return JSON.parse(raw);
  } catch (error) {
    return raw;
  }
}

export const parseStreamEntries = (entries: any[]) => {
  return entries.map(([id, fields]: [string, string[]]) => {
    const obj: any = { id };

    for (let i = 0; i < fields.length; i += 2) {
      obj[fields[i]] = parseStoredValue(fields[i + 1]);
    }

    return obj;
  });
};

export function extractVariableNameFromKey(key: string): string {
  const parts = key.split(":");
  return parts[parts.length - 1];
}

export async function setStoreValue(
  redis: Redis,
  key: string,
  value: unknown,
  ttl?: number,
): Promise<void> {
  const serialized = JSON.stringify(value);

  if (ttl && ttl > 0) {
    await redis.set(key, serialized, "EX", ttl);
  } else {
    await redis.set(key, serialized);
  }
}

export function parseMembers(membersString: string): string[] {
  if (!membersString) return [];
  return membersString
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}

export function parseScoreMembers(
  scoreMembersString: string,
): (number | string)[] {
  if (!scoreMembersString) return [];
  const pairs = scoreMembersString
    .split(",")
    .map((pair) => pair.trim())
    .filter((pair) => pair.length > 0);

  const result: (number | string)[] = [];
  for (const pair of pairs) {
    const [scoreStr, member] = pair.split(":").map((s) => s.trim());
    if (scoreStr && member) {
      const score = parseFloat(scoreStr);
      if (!isNaN(score)) {
        result.push(score, member);
      }
    }
  }
  return result;
}

export async function getStoreValue(
  redis: import("ioredis").Redis,
  key: string,
): Promise<unknown> {
  const keyType = await redis.type(key);

  switch (keyType) {
    case "string": {
      const value = await redis.get(key);
      return parseStoredValue(value);
    }
    case "list": {
      const values = await redis.lrange(key, 0, -1);
      return values.map((value) => parseStoredValue(value));
    }
    case "hash": {
      const hash = await redis.hgetall(key);
      const parsed: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(hash)) {
        parsed[field] = parseStoredValue(value);
      }
      return parsed;
    }
    case "set": {
      const members = await redis.smembers(key);
      return members.map((member) => parseStoredValue(member));
    }
    case "zset": {
      const members = await redis.zrange(key, 0, -1);
      return members.map((member) => parseStoredValue(member));
    }
    case "none":
      return null;
    default:
      return null;
  }
}
