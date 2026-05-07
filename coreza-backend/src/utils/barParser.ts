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

/**
 * Parse a bar from various input formats (JSON string, object with .bar wrapper, OHLCV).
 * Optimized: uses Number() instead of parseFloat(), avoids Date allocation when timestamp
 * is already an ISO string.
 */
export function parseBar(data: any): Bar | null {
  if (!data) return null;

  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return null; }
  }

  if (data.bar) data = data.bar;

  if (typeof data !== "object") return null;

  const timestamp = data.timestamp ?? data.time;
  if (timestamp === undefined) return null;

  return {
    timestamp: typeof timestamp === "number" ? new Date(timestamp).toISOString() : timestamp,
    open: Number(data.open),
    high: Number(data.high),
    low: Number(data.low),
    close: Number(data.close),
    volume: Number(data.volume ?? 0),
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
