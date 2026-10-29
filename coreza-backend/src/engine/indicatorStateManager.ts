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
import { timingNow, observeStage, countLive } from "../utils/liveTiming";
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

export function normalizeIndicatorTimestamp(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeIndicatorType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "bollinger") return "bollinger bands";
  if (normalized === "volumeoscillator") return "volume-oscillator";
  if (
    normalized === "support & resistance" ||
    normalized === "supportresistance"
  ) {
    return "support-resistance";
  }
  return normalized;
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

const STATE_VERSION = 4;

const CALCULATION_PARAM_KEYS = [
  "period",
  "window",
  "fastPeriod",
  "slowPeriod",
  "signalPeriod",
  "stdDev",
  "k_period",
  "d_period",
  "conversion_period",
  "base_period",
  "leading_span_b_period",
  "displacement",
  "session_type",
  "custom_start_time",
  "method",
  "lookback_period",
  "sensitivity",
  "num_levels",
  "short_period",
  "long_period",
  "smoothing",
  "smoothing_method",
  "moving_average_type",
] as const;

function calculationParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    CALCULATION_PARAM_KEYS.flatMap((key) =>
      params[key] === undefined ? [] : [[key, params[key]]],
    ),
  );
}

export function isIndicatorStateCompatible(
  state: IndicatorState,
  indicator: string,
  params: Record<string, unknown>,
): boolean {
  return (
    state.version === STATE_VERSION &&
    normalizeIndicatorType(state.indicator) ===
      normalizeIndicatorType(indicator) &&
    serializeParams(calculationParams(state.params)) ===
      serializeParams(calculationParams(params))
  );
}

function positivePeriod(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : fallback;
}

export function requiredWarmupBars(
  indicator: string,
  params: Record<string, unknown>,
): number {
  switch (normalizeIndicatorType(indicator)) {
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
    case "atr":
      // Wilder and Simple ATR both seed on the period-th valid True Range.
      return positivePeriod(params.period);
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
  get dirtyCount(): number { return this.dirtyKeys.size; }
  lastFlushOutcome: "empty" | "success" | "error" = "empty";
  private readonly l1Cache = new Map<string, IndicatorState>();
  private readonly dirtyKeys = new Set<string>();
  private readonly updaterCache = new Map<string, IncrementalUpdater>();

  constructor(private readonly ttlSeconds?: number, private readonly measureLive = false) {}

  async getState(key: string): Promise<IndicatorState | null> {
    const fromL1 = this.l1Cache.get(key);
    if (fromL1) {
      return fromL1;
    }

    const redis = getRedisCache();
    const raw = await redis.get(key);
    if (!raw) return null;

    const state = JSON.parse(raw) as IndicatorState;
    if (state.version !== STATE_VERSION) return null;
    this.l1Cache.set(key, state);
    return state;
  }

  getStateSync(key: string): IndicatorState | null {
    const state = this.l1Cache.get(key);
    return state?.version === STATE_VERSION ? state : null;
  }

  async setState(key: string, state: IndicatorState): Promise<void> {
    this.l1Cache.set(key, state);

    const startedAt = this.measureLive ? timingNow() : 0;
    let outcome = "error";
    try {
      const redis = getRedisCache();
      if (this.ttlSeconds && this.ttlSeconds > 0) {
        await redis.set(key, JSON.stringify(state), "EX", this.ttlSeconds);
      } else {
        await redis.set(key, JSON.stringify(state));
      }
      outcome = "success";
    } finally {
      if (this.measureLive) observeStage("indicator_immediate_write", startedAt, outcome);
    }
  }

  setStateSync(key: string, state: IndicatorState): void {
    this.l1Cache.set(key, state);
    this.dirtyKeys.add(key);
  }

  async flushToRedis(): Promise<void> {
    this.lastFlushOutcome = "empty";
    if (this.dirtyKeys.size === 0) return;
    this.lastFlushOutcome = "error";

    const redis = getRedisCache();
    const pipeline = redis.pipeline();
    const serializationStartedAt = this.measureLive ? timingNow() : 0;

    let serializationOutcome = "error";
    try {
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
      serializationOutcome = "success";
    } finally {
      if (this.measureLive) observeStage("indicator_serialize", serializationStartedAt, serializationOutcome);
    }

    const flushStartedAt = this.measureLive ? timingNow() : 0;
    try {
      const results = await pipeline.exec();
      this.lastFlushOutcome = !this.measureLive || (results && results.every(([error]) => !error)) ? "success" : "error";
      if (this.measureLive && this.lastFlushOutcome === "error") countLive("indicator_pipeline", "command_error");
    } finally {
      if (this.measureLive) observeStage("indicator_redis_write", flushStartedAt, this.lastFlushOutcome);
    }
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
    const normalizedIndicator = normalizeIndicatorType(indicator);
    const cacheKey = `${normalizedIndicator}:${serializeParams(params)}`;
    let updater = this.updaterCache.get(cacheKey);
    if (!updater) {
      updater = IndicatorService.createIncrementalUpdater(
        normalizedIndicator,
        params,
      );
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
      currentValue: 0,
      previousValue: 0,
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
    const state = this.buildWarmupState(indicator, params, bars);
    if (sync) this.setStateSync(key, state);
    else await this.setState(key, state);
    return state;
  }

  warmUpSync(
    key: string,
    indicator: string,
    params: Record<string, any>,
    bars: any[],
  ): IndicatorState {
    const state = this.buildWarmupState(indicator, params, bars);
    this.setStateSync(key, state);
    return state;
  }

  private buildWarmupState(
    indicator: string,
    params: Record<string, any>,
    bars: any[],
  ): IndicatorState {
    const updater = this.getUpdater(indicator, params);
    const warmup = updater.warmUp(bars);

    const minimumBars = requiredWarmupBars(indicator, params);
    const state: IndicatorState = {
      version: STATE_VERSION,
      indicator,
      params,
      currentValue: warmup.value ?? 0,
      previousValue: warmup.previousValue ?? 0,
      lastBarTime: warmup.lastBarTime,
      warmupCompleted: true,
      isReady: (warmup.acceptedCount ?? bars.length) >= minimumBars,
      internalState: warmup.internalState,
      observedBars: warmup.acceptedCount ?? bars.length,
      requiredWarmupBars: minimumBars,
      lastWarmupTs:
        bars.length > 0
          ? normalizeIndicatorTimestamp(
              bars[bars.length - 1]?.time ??
                bars[bars.length - 1]?.t ??
                bars[bars.length - 1]?.timestamp,
            )
          : null,
    };

    return state;
  }

  async update(key: string, bar: any, sync = false): Promise<IndicatorState> {
    const existing = await this.getState(key);
    if (!existing) {
      throw new Error(`Indicator state not found for key ${key}`);
    }

    const updated = this.applyUpdate(existing, bar);
    if (!updated) return existing;

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

    const updated = this.applyUpdate(existing, bar);
    if (!updated) return existing;
    this.dirtyKeys.add(key);
    return existing;
  }

  private applyUpdate(existing: IndicatorState, bar: any): boolean {
    const barTime = bar?.time ?? bar?.t ?? bar?.timestamp;
    const barTs = normalizeIndicatorTimestamp(barTime);
    const lastBarTs = normalizeIndicatorTimestamp(existing.lastBarTime);
    if (barTs !== null && lastBarTs !== null && barTs <= lastBarTs) return false;
    if (
      barTs !== null &&
      existing.lastWarmupTs != null &&
      barTs <= existing.lastWarmupTs
    ) {
      return false;
    }

    const updater = this.getUpdater(existing.indicator, existing.params);
    const { value, internalState, accepted = true } = updater.update(
      existing.internalState,
      bar,
    );
    if (!accepted) return false;

    existing.previousValue = existing.currentValue;
    existing.currentValue = value ?? 0;
    existing.observedBars = (existing.observedBars ?? 0) + 1;
    existing.requiredWarmupBars ??= requiredWarmupBars(
      existing.indicator,
      existing.params,
    );
    existing.isReady = existing.observedBars >= existing.requiredWarmupBars;
    existing.lastBarTime = String(barTime ?? "");
    existing.lastWarmupTs = undefined;
    existing.internalState = internalState;
    return true;
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
