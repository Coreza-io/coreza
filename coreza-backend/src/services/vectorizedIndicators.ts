/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import Big from "big.js";
import { ADX, Stochastic } from "technicalindicators";
import {
  BollingerBands,
  EMA,
  MACD,
  RSI,
  SMA,
} from "trading-signals";
import { createError } from "../middleware/errorHandler";

export interface VectorizedConfig {
  indicators: string[];
  rsi_period?: number;
  ema_period?: number;
  sma_period?: number;
  macd_fast?: number;
  macd_slow?: number;
  macd_signal?: number;
  bb_period?: number;
  bb_stddev?: number;
  stoch_k?: number;
  stoch_d?: number;
  adx_period?: number;
}

export interface BarLike {
  t?: string;
  timestamp?: string;
  o?: number;
  open?: number;
  h?: number;
  high?: number;
  l?: number;
  low?: number;
  c?: number;
  close?: number;
  v?: number;
  volume?: number;
  [key: string]: any;
}

export interface EnrichedBar extends BarLike {
  rsi?: number | null;
  ema?: number | null;
  sma?: number | null;
  macd?: { macd: number; signal: number; histogram: number } | null;
  bb?: { upper: number; middle: number; lower: number } | null;
  stoch?: { k: number; d: number } | null;
  vwap?: number | null;
  adx?: number | null;
  obv?: number | null;
}

function toNumber(raw: any): number {
  if (raw instanceof Big) {
    return parseFloat(raw.toString());
  }
  return Number(raw);
}

function parseBars(rawBars: any): BarLike[] {
  if (rawBars == null) {
    throw createError("candle_data is required", 400);
  }

  let bars: any = rawBars;
  if (typeof rawBars === "string") {
    try {
      bars = JSON.parse(rawBars);
    } catch (error) {
      throw createError("Invalid JSON in candle_data", 400);
    }
  }

  if (!Array.isArray(bars) || bars.length === 0) {
    throw createError("candle_data must be a non-empty array", 400);
  }

  const normalized = bars.map((bar, index) => {
    if (typeof bar !== "object" || bar == null) {
      throw createError(`Bar at index ${index} is not an object`, 400);
    }
    const close = Number(bar.c ?? bar.close);
    const high = Number(bar.h ?? bar.high);
    const low = Number(bar.l ?? bar.low);
    const open = Number(bar.o ?? bar.open);
    const volume = Number(bar.v ?? bar.volume);

    if ([close, high, low, open, volume].some((v) => !Number.isFinite(v))) {
      throw createError(`Bar at index ${index} contains invalid numeric data`, 400);
    }

    return {
      ...bar,
      t: bar.t ?? bar.timestamp,
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume,
    } as BarLike;
  });

  return normalized;
}

function padWithNulls<T>(values: T[], totalLength: number): (T | null)[] {
  const padding = totalLength - values.length;
  const prefix = Array(Math.max(0, padding)).fill(null);
  return [...prefix, ...values];
}

function calculateRSI(closes: number[], period: number): (number | null)[] {
  const rsi = new RSI(period);
  return closes.map((price) => {
    rsi.update(price, false);
    return rsi.isStable ? toNumber(rsi.getResult()) : null;
  });
}

function calculateEMA(closes: number[], period: number): (number | null)[] {
  const ema = new EMA(period);
  return closes.map((price) => {
    ema.update(price, false);
    return ema.isStable ? toNumber(ema.getResult()) : null;
  });
}

function calculateSMA(closes: number[], period: number): (number | null)[] {
  const sma = new SMA(period);
  return closes.map((price) => {
    sma.update(price, false);
    return sma.isStable ? toNumber(sma.getResult()) : null;
  });
}

function calculateMACD(
  closes: number[],
  fast: number,
  slow: number,
  signal: number
): ({ macd: number; signal: number; histogram: number } | null)[] {
  const macd = new MACD({
    indicator: EMA,
    shortInterval: fast,
    longInterval: slow,
    signalInterval: signal,
  });

  return closes.map((price) => {
    macd.update(price, false);
    if (!macd.isStable) return null;
    const value = macd.getResult();
    if (!value) return null;
    return {
      macd: toNumber(value.macd),
      signal: toNumber(value.signal),
      histogram: toNumber(value.histogram),
    };
  });
}

function calculateBollinger(
  closes: number[],
  period: number,
  stdDev: number
): ({ upper: number; middle: number; lower: number } | null)[] {
  const bb = new BollingerBands({
    indicator: SMA,
    interval: period,
    stdDev,
  });

  return closes.map((price) => {
    bb.update(price, false);
    if (!bb.isStable) return null;
    const value = bb.getResult();
    return {
      upper: toNumber(value.upper),
      middle: toNumber(value.middle),
      lower: toNumber(value.lower),
    };
  });
}

function calculateStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod: number,
  dPeriod: number
): ({ k: number; d: number } | null)[] {
  const values = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: kPeriod,
    signalPeriod: dPeriod,
  });

  const padded = padWithNulls(values, closes.length);
  return padded.map((val) => (val ? { k: Number(val.k), d: Number(val.d) } : null));
}

function calculateVWAP(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[]
): number[] {
  const vwap: number[] = [];
  let cumulativePV = 0;
  let cumulativeVolume = 0;

  for (let i = 0; i < closes.length; i++) {
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
    cumulativePV += typicalPrice * volumes[i];
    cumulativeVolume += volumes[i];
    vwap.push(cumulativeVolume === 0 ? typicalPrice : cumulativePV / cumulativeVolume);
  }

  return vwap;
}

function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number
): (number | null)[] {
  const values = ADX.calculate({ high: highs, low: lows, close: closes, period });
  return padWithNulls(values, closes.length).map((val) => (val ? Number(val) : null));
}

function calculateOBV(closes: number[], volumes: number[]): number[] {
  const obv: number[] = [];
  let current = 0;

  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      current = volumes[i];
    } else if (closes[i] > closes[i - 1]) {
      current += volumes[i];
    } else if (closes[i] < closes[i - 1]) {
      current -= volumes[i];
    }
    obv.push(current);
  }

  return obv;
}

export class VectorizedIndicatorsService {
  static async enrichBarsWithIndicators(
    rawBars: any,
    config: VectorizedConfig
  ): Promise<{ success: boolean; data: EnrichedBar[] }> {
    const bars = parseBars(rawBars);
    if (!config.indicators || config.indicators.length === 0) {
      throw createError("At least one indicator must be specified", 400);
    }

    const closes = bars.map((b) => Number(b.c));
    const highs = bars.map((b) => Number(b.h));
    const lows = bars.map((b) => Number(b.l));
    const volumes = bars.map((b) => Number(b.v));

    const indicatorSet = new Set(config.indicators.map((i) => i.toLowerCase()));

    const rsiValues = indicatorSet.has("rsi")
      ? calculateRSI(closes, config.rsi_period ?? 14)
      : [];
    const emaValues = indicatorSet.has("ema")
      ? calculateEMA(closes, config.ema_period ?? 20)
      : [];
    const smaValues = indicatorSet.has("sma")
      ? calculateSMA(closes, config.sma_period ?? 50)
      : [];
    const macdValues = indicatorSet.has("macd")
      ? calculateMACD(
          closes,
          config.macd_fast ?? 12,
          config.macd_slow ?? 26,
          config.macd_signal ?? 9
        )
      : [];
    const bbValues = indicatorSet.has("bb")
      ? calculateBollinger(closes, config.bb_period ?? 20, config.bb_stddev ?? 2)
      : [];
    const stochValues = indicatorSet.has("stochastic")
      ? calculateStochastic(
          highs,
          lows,
          closes,
          config.stoch_k ?? 14,
          config.stoch_d ?? 3
        )
      : [];
    const vwapValues = indicatorSet.has("vwap")
      ? calculateVWAP(highs, lows, closes, volumes)
      : [];
    const adxValues = indicatorSet.has("adx")
      ? calculateADX(highs, lows, closes, config.adx_period ?? 14)
      : [];
    const obvValues = indicatorSet.has("obv")
      ? calculateOBV(closes, volumes)
      : [];

    const enriched: EnrichedBar[] = bars.map((bar, index) => ({
      ...bar,
      rsi: rsiValues[index] ?? null,
      ema: emaValues[index] ?? null,
      sma: smaValues[index] ?? null,
      macd: macdValues[index] ?? null,
      bb: bbValues[index] ?? null,
      stoch: stochValues[index] ?? null,
      vwap: vwapValues[index] ?? null,
      adx: adxValues[index] ?? null,
      obv: obvValues[index] ?? null,
    }));

    return { success: true, data: enriched };
  }
}

export default VectorizedIndicatorsService;
