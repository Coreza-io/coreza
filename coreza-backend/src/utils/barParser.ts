/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { Bar } from "../backtest/simBroker/interfaces";

type UnknownRecord = Record<string, unknown>;

function parseTimestamp(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;
  return /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : Date.parse(value);
}

/**
 * Parse a bar from various input formats (JSON string, object with .bar wrapper, OHLCV).
 * Uses Number() instead of permissive parseFloat() and rejects invalid timestamps
 * or non-finite OHLCV values.
 */
export function parseBar(input: unknown, { includeEnd = false } = {}): Bar | null {
  let data = input;
  if (!data) return null;

  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return null; }
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const record = data as UnknownRecord;
  data = record.bar ?? data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const bar = data as UnknownRecord;

  const timestampMs = parseTimestamp((includeEnd ? bar.startTimestamp : undefined) ?? bar.timestamp ?? bar.time ?? bar.t);
  const end = includeEnd ? bar.endTimestamp ?? bar.closeTime : undefined;
  const endMs = end == null ? undefined : parseTimestamp(end);
  if (endMs !== undefined && (!Number.isFinite(endMs) || endMs <= timestampMs)) return null;
  const open = Number(bar.open ?? bar.o);
  const high = Number(bar.high ?? bar.h);
  const low = Number(bar.low ?? bar.l);
  const close = Number(bar.close ?? bar.c);
  const volume = Number(bar.volume ?? bar.v ?? 0);
  if (![timestampMs, open, high, low, close, volume].every(Number.isFinite)) return null;

  return {
    timestamp: new Date(timestampMs).toISOString(),
    ...(endMs !== undefined && { endTimestamp: new Date(endMs).toISOString() }),
    open,
    high,
    low,
    close,
    volume,
  };
}

/**
 * Parse a prices map from various input formats.
 */
export function parsePrices(data: any): Record<string, number> | null {
  if (!data) return null;

  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return null; }
  }

  if (typeof data !== "object" || Array.isArray(data)) return null;

  const parsed = Object.entries(data).reduce<Record<string, number>>(
    (acc, [symbol, price]) => {
      const num = Number(price);
      if (Number.isFinite(num)) acc[symbol] = num;
      return acc;
    },
    {},
  );

  return Object.keys(parsed).length > 0 ? parsed : null;
}

/**
 * Convert a value to a percentage of a base.
 */
export function toPercent(value: number, base: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return 0;
  return (value / base) * 100;
}
