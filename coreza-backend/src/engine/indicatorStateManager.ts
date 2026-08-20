/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { getRedisCache } from "../config/redis";
import { buildIndicatorKey } from "../utils/executionKey";
export { buildIndicatorKey } from "../utils/executionKey";
import {
  IndicatorService,
  IncrementalUpdater,
} from "../nodes/logic/indicators";

export interface IndicatorState {
  version: number;
  indicator: string;
  params: Record<string, any>;
  currentValue: number | Record<string, any> | null;
  previousValue: number | Record<string, any> | null;
  lastBarTime: string;
  warmupCompleted: boolean;
  isReady: boolean;
  observedBars: number;
  requiredWarmupBars: number;
  internalState: Record<string, any>;
  lastWarmupTs?: number | null;
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

const STATE_VERSION = 3;

function positivePeriod(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : fallback;
}

export function requiredWarmupBars(
  indicator: string,
  params: Record<string, unknown>,
): number {
  switch (indicator.trim().toLowerCase()) {
    case "rsi":
      return positivePeriod(params.period ?? params.window) + 1;
    case "ema":
    case "sma":
    case "bollinger bands":
      return positivePeriod(params.period ?? params.window);
    case "macd":
      return (
        positivePeriod(params.slowPeriod) + positivePeriod(params.signalPeriod)
      );
    case "adx":
      return positivePeriod(params.period) * 2;
    case "stochastic":
      return (
        positivePeriod(params.k_period) + positivePeriod(params.d_period) - 1
      );
    case "ichimoku":
      return positivePeriod(params.leading_span_b_period);
    case "volume-oscillator":
    case "volumeoscillator":
      return positivePeriod(params.long_period);
    case "support-resistance":
    case "support & resistance":
    case "supportresistance":
      return positivePeriod(params.lookback_period);
    default:
      return 1;
  }
}

export class IndicatorStateManager {
  private readonly l1Cache = new Map<string, IndicatorState>();
  private readonly dirtyKeys = new Set<string>();
  private readonly updaterCache = new Map<string, IncrementalUpdater>();

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
    this.updaterCache.clear();
  }

  private getUpdater(
    indicator: string,
    params: Record<string, any>,
  ): IncrementalUpdater {
    const cacheKey = `${indicator}:${serializeParams(params)}`;
    let updater = this.updaterCache.get(cacheKey);
    if (!updater) {
      updater = IndicatorService.createIncrementalUpdater(indicator, params);
      this.updaterCache.set(cacheKey, updater);
    }
    return updater;
  }

  async initialize(
    key: string,
    indicator: string,
    params: Record<string, any>,
    sync = false,
  ): Promise<IndicatorState> {
    const updater = this.getUpdater(indicator, params);
    const empty = updater.warmUp([]);
    const state: IndicatorState = {
      version: STATE_VERSION,
      indicator,
      params,
      currentValue: null,
      previousValue: null,
      lastBarTime: "",
      warmupCompleted: false,
      isReady: false,
      observedBars: 0,
      requiredWarmupBars: requiredWarmupBars(indicator, params),
      internalState: empty.internalState,
      lastWarmupTs: null,
    };

    if (sync) this.setStateSync(key, state);
    else await this.setState(key, state);
    return state;
  }

  markWarmupCompleted(key: string): IndicatorState | null {
    const state = this.l1Cache.get(key);
    if (!state) return null;
    state.warmupCompleted = true;
    this.dirtyKeys.add(key);
    return state;
  }

  async warmUp(
    key: string,
    indicator: string,
    params: Record<string, any>,
    bars: any[],
    sync = false,
  ): Promise<IndicatorState> {
    const updater = this.getUpdater(indicator, params);
    const warmup = updater.warmUp(bars);

    const minimumBars = requiredWarmupBars(indicator, params);
    const state: IndicatorState = {
      version: STATE_VERSION,
      indicator,
      params,
      currentValue: warmup.value,
      previousValue: null,
      lastBarTime: warmup.lastBarTime,
      warmupCompleted: true,
      isReady:
        bars.length >= minimumBars &&
        warmup.value !== null &&
        warmup.value !== undefined,
      internalState: warmup.internalState,
      observedBars: bars.length,
      requiredWarmupBars: minimumBars,
      lastWarmupTs:
        bars.length > 0
          ? (((bars[bars.length - 1]?.time ?? bars[bars.length - 1]?.t) as
              | number
              | undefined) ?? null)
          : null,
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

    const barTs = bar?.time ?? bar?.t;
    if (typeof barTs === "number" && existing.lastWarmupTs != null) {
      if (barTs <= existing.lastWarmupTs) {
        return existing;
      }

      existing.lastWarmupTs = undefined;
    }

    const updater = this.getUpdater(existing.indicator, existing.params);

    const { value, internalState } = updater.update(
      existing.internalState,
      bar,
    );

    existing.previousValue = existing.currentValue;
    existing.currentValue = value;
    existing.observedBars = (existing.observedBars ?? 0) + 1;
    existing.requiredWarmupBars ??= requiredWarmupBars(
      existing.indicator,
      existing.params,
    );
    existing.isReady =
      existing.observedBars >= existing.requiredWarmupBars &&
      value !== null &&
      value !== undefined;
    existing.lastBarTime = String(bar?.time ?? bar?.t ?? "");
    existing.internalState = internalState;

    if (sync) {
      this.setStateSync(key, existing);
    } else {
      await this.setState(key, existing);
    }
    return existing;
  }

  updateSync(key: string, bar: any): IndicatorState {
    const existing = this.l1Cache.get(key);
    if (!existing) {
      throw new Error(`Indicator state not found for key ${key}`);
    }

    const barTs = bar?.time ?? bar?.t;
    if (typeof barTs === "number" && existing.lastWarmupTs != null) {
      if (barTs <= existing.lastWarmupTs) {
        return existing;
      }

      existing.lastWarmupTs = undefined;
    }

    const updater = this.getUpdater(existing.indicator, existing.params);
    const { value, internalState } = updater.update(
      existing.internalState,
      bar,
    );

    existing.previousValue = existing.currentValue;
    existing.currentValue = value;
    existing.observedBars = (existing.observedBars ?? 0) + 1;
    existing.requiredWarmupBars ??= requiredWarmupBars(
      existing.indicator,
      existing.params,
    );
    existing.isReady =
      existing.observedBars >= existing.requiredWarmupBars &&
      value !== null &&
      value !== undefined;
    existing.lastBarTime = String(bar?.time ?? bar?.t ?? "");
    existing.internalState = internalState;
    this.dirtyKeys.add(key);
    return existing;
  }

  async invalidate(key: string): Promise<void> {
    this.l1Cache.delete(key);
    this.dirtyKeys.delete(key);
    await getRedisCache().del(key);
  }

  async clearWorkflow(userId: string, workflowId: string): Promise<number> {
    const redis = getRedisCache();
    const pattern = `indicator:userId:${userId}:workflowId:${workflowId}:executionId:*`;
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

  async clearExecutionScope(
    userId: string,
    workflowId: string,
    executionId: string,
  ): Promise<number> {
    const redis = getRedisCache();
    const pattern = `indicator:userId:${userId}:workflowId:${workflowId}:executionId:${executionId}:*`;
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
      if (keys.length > 0) {
        removed += keys.length;
        await redis.del(...keys);
      }
    } while (cursor !== "0");
    this.clearL1Cache();
    return removed;
  }
}
