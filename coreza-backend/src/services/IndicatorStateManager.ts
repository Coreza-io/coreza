/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { getRedisCache } from "../config/redis";

const INDICATOR_STATE_TTL_SECONDS = 24 * 60 * 60;
const STATE_SCHEMA_VERSION = "1";

export interface PersistedIndicatorState {
  type: string;
  paramsHash: string;
  params: Record<string, any>;
  state: Record<string, any>;
  lastTimestamp?: string;
  lastValue?: any;
  version: string;
}

export class IndicatorStateManager {
  static buildStateKey(
    workflowId: string,
    nodeId: string,
    symbol = "unknown",
    interval = "unknown",
  ): string {
    return `indicator:state:${workflowId}:${nodeId}:${symbol}:${interval}`;
  }

  static async hasState(stateKey: string): Promise<boolean> {
    const redis = getRedisCache();
    const exists = await redis.exists(stateKey);
    return exists === 1;
  }

  static async getState(
    stateKey: string,
  ): Promise<PersistedIndicatorState | null> {
    const redis = getRedisCache();
    const raw = await redis.hgetall(stateKey);
    if (!raw || Object.keys(raw).length === 0) {
      return null;
    }

    return {
      type: raw.type,
      paramsHash: raw.paramsHash,
      params: raw.params ? JSON.parse(raw.params) : {},
      state: raw.state ? JSON.parse(raw.state) : {},
      lastTimestamp: raw.lastTimestamp,
      lastValue: raw.lastValue ? JSON.parse(raw.lastValue) : undefined,
      version: raw.version || STATE_SCHEMA_VERSION,
    };
  }

  static async saveState(
    stateKey: string,
    payload: Omit<PersistedIndicatorState, "version">,
  ): Promise<void> {
    const redis = getRedisCache();
    await redis.hset(stateKey, {
      type: payload.type,
      paramsHash: payload.paramsHash,
      params: JSON.stringify(payload.params ?? {}),
      state: JSON.stringify(payload.state ?? {}),
      lastTimestamp: payload.lastTimestamp ?? "",
      lastValue: JSON.stringify(payload.lastValue ?? null),
      version: STATE_SCHEMA_VERSION,
    });
    await redis.expire(stateKey, INDICATOR_STATE_TTL_SECONDS);
  }

  static async deleteState(stateKey: string): Promise<void> {
    const redis = getRedisCache();
    await redis.del(stateKey);
  }

  static async cleanupByWorkflow(workflowId: string): Promise<number> {
    const redis = getRedisCache();
    const keys = await redis.keys(`indicator:state:${workflowId}:*`);
    if (keys.length === 0) {
      return 0;
    }
    return redis.del(...keys);
  }
}

export default IndicatorStateManager;
