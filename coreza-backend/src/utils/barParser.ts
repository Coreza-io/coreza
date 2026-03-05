/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { Bar } from "../services/simBroker/interfaces";

/**
 * Parse a bar from various input formats (JSON string, object with .bar wrapper, OHLCV).
 */
export function parseBar(data: any): Bar | null {
  if (!data) return null;

  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { return null; }
  }

  if (data.bar) data = data.bar;

  if (
    typeof data.time !== "number" ||
    data.open === undefined ||
    data.high === undefined ||
    data.low === undefined ||
    data.close === undefined
  ) {
    return null;
  }

  return {
    timestamp: new Date(data.time).toISOString(),
    open: parseFloat(data.open),
    high: parseFloat(data.high),
    low: parseFloat(data.low),
    close: parseFloat(data.close),
    volume: parseFloat(data.volume ?? 0),
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
