/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { getRedisCache } from "../config/redis";
import { buildIndicatorKey } from "../utils/executionKey";
export { buildIndicatorKey } from "../utils/executionKey";
import { IndicatorService } from "./indicators";

export interface IndicatorState {
  version: number;
  indicator: string;
  params: Record<string, any>;
  currentValue: number | Record<string, any> | null;
  previousValue: number | Record<string, any> | null;
  lastBarTime: string;
  warmupCompleted: boolean;
  internalState: Record<string, any>;
}

export function serializeParams(params: Record<string, any>): string {
  const normalize = (value: any): string => {
    if (Array.isArray(value)) {
      return `[${value.map((item) => normalize(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${key}:${normalize(value[key])}`)
        .join(",")}}`;
    }
    return String(value);
  };

  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${normalize(params[k])}`)
    .join(":");
}

const STATE_VERSION = 2;

export class IndicatorStateManager {
  private readonly l1Cache = new Map<string, IndicatorState>();
  private readonly dirtyKeys = new Set<string>();

  constructor(private readonly ttlSeconds?: number) {}

  async getState(key: string): Promise<IndicatorState | null> {
    const fromL1 = this.l1Cache.get(key);
    if (fromL1) {
      return fromL1;
    }

    const redis = getRedisCache();
    const raw = await redis.get(key);
    if (!raw) return null;

    const state = JSON.parse(raw) as IndicatorState;
    this.l1Cache.set(key, state);
    return state;
  }

  getStateSync(key: string): IndicatorState | null {
    return this.l1Cache.get(key) ?? null;
  }

  async setState(key: string, state: IndicatorState): Promise<void> {
    this.l1Cache.set(key, state);

    const redis = getRedisCache();
    if (this.ttlSeconds && this.ttlSeconds > 0) {
      await redis.set(key, JSON.stringify(state), "EX", this.ttlSeconds);
      return;
    }

    await redis.set(key, JSON.stringify(state));
  }

  setStateSync(key: string, state: IndicatorState): void {
    this.l1Cache.set(key, state);
    this.dirtyKeys.add(key);
  }

  async flushToRedis(): Promise<void> {
    if (this.dirtyKeys.size === 0) return;

    const redis = getRedisCache();
    const pipeline = redis.pipeline();

    for (const key of this.dirtyKeys) {
      const state = this.l1Cache.get(key);
      if (!state) continue;

      const json = JSON.stringify(state);
      if (this.ttlSeconds && this.ttlSeconds > 0) {
        pipeline.set(key, json, "EX", this.ttlSeconds);
      } else {
        pipeline.set(key, json);
      }
    }

    await pipeline.exec();
    this.dirtyKeys.clear();
  }

  clearL1Cache(): void {
    this.l1Cache.clear();
    this.dirtyKeys.clear();
  }

  async warmUp(
    key: string,
    indicator: string,
    params: Record<string, any>,
    bars: any[],
    sync = false,
  ): Promise<IndicatorState> {
    const updater = IndicatorService.createIncrementalUpdater(
      indicator,
      params,
    );
    const warmup = updater.warmUp(bars);

    const state: IndicatorState = {
      version: STATE_VERSION,
      indicator,
      params,
      currentValue: warmup.value,
      previousValue: null,
      lastBarTime: warmup.lastBarTime,
      warmupCompleted: true,
      internalState: warmup.internalState,
    };

    if (sync) {
      this.setStateSync(key, state);
    } else {
      await this.setState(key, state);
    }
    return state;
  }

  async update(key: string, bar: any, sync = false): Promise<IndicatorState> {
    const existing = await this.getState(key);
    if (!existing) {
      throw new Error(`Indicator state not found for key ${key}`);
    }

    const updater = IndicatorService.createIncrementalUpdater(
      existing.indicator,
      existing.params,
    );

    const { value, internalState } = updater.update(
      existing.internalState,
      bar,
    );

    const updatedState: IndicatorState = {
      ...existing,
      previousValue: existing.currentValue,
      currentValue: value,
      lastBarTime: String(bar?.time ?? ""),
      internalState,
    };

    if (sync) {
      this.setStateSync(key, updatedState);
    } else {
      await this.setState(key, updatedState);
    }
    return updatedState;
  }

  updateSync(key: string, bar: any): IndicatorState {
    const existing = this.l1Cache.get(key);
    if (!existing) {
      throw new Error(`Indicator state not found for key ${key}`);
    }

    const updater = IndicatorService.createIncrementalUpdater(
      existing.indicator,
      existing.params,
    );
    const { value, internalState } = updater.update(existing.internalState, bar);

    const updatedState: IndicatorState = {
      ...existing,
      previousValue: existing.currentValue,
      currentValue: value,
      lastBarTime: String(bar?.time ?? ""),
      internalState,
    };

    this.setStateSync(key, updatedState);
    return updatedState;
  }

  async invalidate(key: string): Promise<void> {
    this.l1Cache.delete(key);
    this.dirtyKeys.delete(key);
    await getRedisCache().del(key);
  }

  async clearWorkflow(userId: string, workflowId: string): Promise<number> {
    const redis = getRedisCache();
    const pattern = `user:${userId}:workflow:${workflowId}:indicator:*`;
    let cursor = "0";
    let removed = 0;

    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        200,
      );
      cursor = next;

      if (keys.length) {
        removed += keys.length;
        for (const key of keys) {
          this.l1Cache.delete(key);
          this.dirtyKeys.delete(key);
        }
        await redis.del(...keys);
      }
    } while (cursor !== "0");

    return removed;
  }
}
