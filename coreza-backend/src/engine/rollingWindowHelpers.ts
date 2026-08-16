/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { RollingWindow } from "./RollingWindow";

export interface RollingWindowPayload {
  window: unknown[];
  count: number;
  size: number;
  isReady: boolean;
  remaining: number;
  latest: unknown | null;
  found: boolean;
}

export interface RollingWindowNotFoundPayload extends RollingWindowPayload {
  ready: false;
  reason: string;
}

export const ROLLING_WINDOW_ERRORS = {
  symbolRequired: "symbol is required for get operation",
  timeframeRequired: "timeframe is required for get operation",
  unresolvedTemplate:
    "Candle data contains unresolved template references. Execute the upstream node first.",
  invalidCandleData: "Invalid candle_data format",
  noBars: "No bars provided in candle_data",
} as const;

export function buildRollingWindowNotFoundPayload(
  symbol: string,
  timeframe: string,
): RollingWindowNotFoundPayload {
  return {
    ...buildRollingWindowPayload(undefined),
    ready: false,
    reason: `no window for ${symbol}/${timeframe} in this execution`,
  };
}

export function normalizeSymbol(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

export function normalizeTimeframe(value: unknown): string {
  return String(value ?? "").trim();
}

export function clampWindowSize(value: unknown): number {
  return Math.min(Math.max(parseInt(String(value ?? ""), 10) || 20, 1), 500);
}

export function buildRollingWindowPayload(
  window: RollingWindow<unknown> | undefined,
): RollingWindowPayload {
  if (!window) {
    return {
      window: [],
      count: 0,
      size: 0,
      isReady: false,
      remaining: 0,
      latest: null,
      found: false,
    };
  }

  return {
    window: [...window.values()],
    count: window.count,
    size: window.size,
    isReady: window.isReady,
    remaining: window.size - window.count,
    latest: window.count > 0 ? window.at(0) : null,
    found: true,
  };
}

export type ParsedBars =
  | { ok: true; bars: unknown[] }
  | { ok: false; error: string };

export function parseCandleData(raw: unknown): ParsedBars {
  let bars: unknown[];

  if (Array.isArray(raw)) {
    bars = raw;
  } else if (raw && typeof raw === "object") {
    bars = [raw];
  } else if (typeof raw === "string") {
    if (raw.includes("{{")) {
      return { ok: false, error: ROLLING_WINDOW_ERRORS.unresolvedTemplate };
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      bars = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return { ok: false, error: ROLLING_WINDOW_ERRORS.invalidCandleData };
    }
  } else {
    bars = [];
  }

  return bars.length > 0
    ? { ok: true, bars }
    : { ok: false, error: ROLLING_WINDOW_ERRORS.noBars };
}
