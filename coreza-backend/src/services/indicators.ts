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

// src/services/IndicatorService.ts

import { RSI, EMA, SMA, MACD, BollingerBands } from "trading-signals";
import { ADX, Stochastic, IchimokuCloud } from "technicalindicators";
import Big from "big.js";
import { createError } from "../middleware/errorHandler";
import { StandardNodeOutput } from "../types/nodeOutput";
import {
  createSuccessOutput,
  createErrorOutput,
} from "../utils/normalizeOutput";

export interface IndicatorInput {
  prices?: any;
  candle_data?: any;
  symbol?: string;
  period?: string | number;
  window?: String;
  fastPeriod?: String;
  slowPeriod?: String;
  signalPeriod?: String;
  stdDev?: String;
  k_period?: String;
  d_period?: String;
  conversion_period?: String;
  base_period?: String;
  leading_span_b_period?: String;
  displacement?: String;
  session_type?: string;
  custom_start_time?: string;
  method?: string;
  lookback_period?: string;
  sensitivity?: string;
  num_levels?: string;
  short_period?: String;
  long_period?: String;
  type?: string;
  [key: string]: any;
}

export type IndicatorResult = StandardNodeOutput<any[]>;

export interface IncrementalWarmupResult {
  internalState: Record<string, any>;
  value: number | Record<string, any> | null;
  samples: number;
  lastBarTime: string;
}

export interface IncrementalUpdateResult {
  value: number | Record<string, any> | null;
  internalState: Record<string, any>;
  samples: number;
}

export interface IncrementalUpdater {
  warmUp: (bars: any[]) => IncrementalWarmupResult;
  update: (state: Record<string, any>, bar: any) => IncrementalUpdateResult;
}

// Helper to parse JSON string arrays
function parseArray<T>(raw: any, fieldName: string): T[] {
  if (raw == null) throw createError(`${fieldName} is required`, 400);
  let arr: any;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      throw createError(`Invalid JSON in ${fieldName}`, 400);
    }
  } else {
    arr = raw;
  }
  if (!Array.isArray(arr))
    throw createError(`${fieldName} must be an array`, 400);
  return arr;
}

// Helper to extract close prices (supports raw numbers or candle objects)
function extractPrices(rawPrices: any, rawCandles: any): number[] {
  const dataField = rawPrices != null ? "prices" : "candle_data";
  const raw = rawPrices != null ? rawPrices : rawCandles;
  const arr = parseArray<any>(raw, dataField);
  const values: number[] = arr
    .map((item) => {
      if (typeof item === "object") {
        const val = item.c ?? item.close;
        return Number(val);
      }
      return Number(item);
    })
    .filter((v) => Number.isFinite(v));
  if (values.length === 0)
    throw createError("No valid numeric prices found", 400);
  return values;
}

// Helper to normalize Big.js instances (and any other value) to plain number
function toNumber(raw: any): number {
  if (raw instanceof Big) {
    return parseFloat(raw.toString());
  }
  return Number(raw);
}

function asClose(bar: any): number {
  return Number(bar?.c ?? bar?.close ?? bar?.price ?? bar);
}

function asHigh(bar: any): number {
  return Number(bar?.h ?? bar?.high);
}

function asLow(bar: any): number {
  return Number(bar?.l ?? bar?.low);
}

function asVolume(bar: any): number {
  return Number(bar?.v ?? bar?.volume ?? 0);
}

function asBarTime(bar: any): string {
  return String(bar?.t ?? bar?.timestamp ?? "");
}

function clampWindow(window: number[], size: number): number[] {
  if (window.length > size) window.shift();
  return window;
}

const INDICATOR_CONTEXT = { category: "indicators" };

export class IndicatorService {
  static createIncrementalUpdater(
    indicatorType: string,
    params: Record<string, any>,
  ): IncrementalUpdater {
    const type = indicatorType.toLowerCase();
    switch (type) {
      case "ema": {
        const period = Number(params.window ?? params.period);
        if (!Number.isFinite(period) || period <= 0) {
          throw createError("period/window must be a positive number", 400);
        }
        const multiplier = 2 / (period + 1);

        return {
          warmUp: (bars) => {
            let prevEma: number | null = null;
            for (const bar of bars) {
              const close = asClose(bar);
              if (!Number.isFinite(close)) continue;
              prevEma = prevEma == null ? close : close * multiplier + prevEma * (1 - multiplier);
            }
            return {
              internalState: { prevEma, multiplier, period, samples: bars.length },
              value: prevEma,
              samples: bars.length,
              lastBarTime: bars.length ? asBarTime(bars[bars.length - 1]) : "",
            };
          },
          update: (state, bar) => {
            const close = asClose(bar);
            const prevEma = Number.isFinite(state.prevEma) ? state.prevEma : close;
            const ema = close * state.multiplier + prevEma * (1 - state.multiplier);
            const samples = Number(state.samples || 0) + 1;
            return {
              value: ema,
              samples,
              internalState: { ...state, prevEma: ema, samples },
            };
          },
        };
      }
      case "sma": {
        const period = Number(params.period ?? params.window);
        if (!Number.isFinite(period) || period <= 0) {
          throw createError("period/window must be a positive number", 400);
        }
        return {
          warmUp: (bars) => {
            const closes = bars.map(asClose).filter(Number.isFinite);
            const window = closes.slice(-period);
            const value = window.length === period ? window.reduce((a, b) => a + b, 0) / period : null;
            return {
              internalState: { window, period, samples: closes.length },
              value,
              samples: closes.length,
              lastBarTime: bars.length ? asBarTime(bars[bars.length - 1]) : "",
            };
          },
          update: (state, bar) => {
            const window = [...(state.window || []), asClose(bar)];
            clampWindow(window, state.period);
            const samples = Number(state.samples || 0) + 1;
            const value = window.length === state.period ? window.reduce((a: number, b: number) => a + b, 0) / state.period : null;
            return { value, samples, internalState: { ...state, window, samples } };
          },
        };
      }
      case "rsi": {
        const period = Number(params.period ?? params.window);
        if (!Number.isFinite(period) || period <= 0) {
          throw createError("period/window must be a positive number", 400);
        }
        return {
          warmUp: (bars) => {
            const closes = bars.map(asClose).filter(Number.isFinite);
            let avgGain = 0;
            let avgLoss = 0;
            for (let i = 1; i < closes.length; i++) {
              const change = closes[i] - closes[i - 1];
              const gain = Math.max(change, 0);
              const loss = Math.max(-change, 0);
              if (i <= period) {
                avgGain += gain;
                avgLoss += loss;
              } else {
                avgGain = (avgGain * (period - 1) + gain) / period;
                avgLoss = (avgLoss * (period - 1) + loss) / period;
              }
            }
            if (closes.length > 1) {
              avgGain = closes.length - 1 <= period ? avgGain / period : avgGain;
              avgLoss = closes.length - 1 <= period ? avgLoss / period : avgLoss;
            }
            const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
            const value = closes.length > period ? 100 - 100 / (1 + rs) : null;
            return {
              internalState: {
                period,
                avgGain,
                avgLoss,
                prevClose: closes[closes.length - 1],
                samples: closes.length,
              },
              value,
              samples: closes.length,
              lastBarTime: bars.length ? asBarTime(bars[bars.length - 1]) : "",
            };
          },
          update: (state, bar) => {
            const close = asClose(bar);
            const prevClose = Number(state.prevClose);
            const change = close - prevClose;
            const gain = Math.max(change, 0);
            const loss = Math.max(-change, 0);
            const avgGain = (state.avgGain * (state.period - 1) + gain) / state.period;
            const avgLoss = (state.avgLoss * (state.period - 1) + loss) / state.period;
            const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
            const value = 100 - 100 / (1 + rs);
            const samples = Number(state.samples || 0) + 1;
            return {
              value,
              samples,
              internalState: { ...state, prevClose: close, avgGain, avgLoss, samples },
            };
          },
        };
      }
      case "macd": {
        const shortPeriod = Number(params.fastPeriod);
        const longPeriod = Number(params.slowPeriod);
        const signalPeriod = Number(params.signalPeriod);
        if (
          [shortPeriod, longPeriod, signalPeriod].some(
            (value) => !Number.isFinite(value) || value <= 0,
          )
        ) {
          throw createError("fastPeriod/slowPeriod/signalPeriod must be positive", 400);
        }
        const shortMult = 2 / (shortPeriod + 1);
        const longMult = 2 / (longPeriod + 1);
        const signalMult = 2 / (signalPeriod + 1);
        return {
          warmUp: (bars) => {
            let shortEma: number | null = null;
            let longEma: number | null = null;
            let signalEma: number | null = null;
            let value: Record<string, number> | null = null;
            for (const bar of bars) {
              const close = asClose(bar);
              shortEma = shortEma == null ? close : close * shortMult + shortEma * (1 - shortMult);
              longEma = longEma == null ? close : close * longMult + longEma * (1 - longMult);
              const macd = shortEma - longEma;
              signalEma = signalEma == null ? macd : macd * signalMult + signalEma * (1 - signalMult);
              value = { macd, signal: signalEma, histogram: macd - signalEma };
            }
            return {
              internalState: { shortEma, longEma, signalEma, shortMult, longMult, signalMult, samples: bars.length },
              value,
              samples: bars.length,
              lastBarTime: bars.length ? asBarTime(bars[bars.length - 1]) : "",
            };
          },
          update: (state, bar) => {
            const close = asClose(bar);
            const shortEma = close * state.shortMult + state.shortEma * (1 - state.shortMult);
            const longEma = close * state.longMult + state.longEma * (1 - state.longMult);
            const macd = shortEma - longEma;
            const signalEma = macd * state.signalMult + state.signalEma * (1 - state.signalMult);
            const samples = Number(state.samples || 0) + 1;
            return {
              value: { macd, signal: signalEma, histogram: macd - signalEma },
              samples,
              internalState: { ...state, shortEma, longEma, signalEma, samples },
            };
          },
        };
      }
      case "bollinger bands": {
        const period = Number(params.period);
        const stdDev = Number(params.stdDev ?? params.std_dev_multiplier);
        if (!Number.isFinite(period) || period <= 0) {
          throw createError("period must be a positive number", 400);
        }
        if (!Number.isFinite(stdDev) || stdDev <= 0) {
          throw createError("stdDev/std_dev_multiplier must be a positive number", 400);
        }
        return {
          warmUp: (bars) => {
            const window = bars.map(asClose).filter(Number.isFinite).slice(-period);
            const mid = window.length === period ? window.reduce((a, b) => a + b, 0) / period : null;
            let value: Record<string, number> | null = null;
            if (mid != null) {
              const variance = window.reduce((sum, p) => sum + (p - mid) ** 2, 0) / period;
              const sd = Math.sqrt(variance);
              value = { upper: mid + sd * stdDev, middle: mid, lower: mid - sd * stdDev, bb_width: ((sd * 2 * stdDev) / mid) * 100 };
            }
            return {
              internalState: { window, period, stdDev, samples: bars.length },
              value,
              samples: bars.length,
              lastBarTime: bars.length ? asBarTime(bars[bars.length - 1]) : "",
            };
          },
          update: (state, bar) => {
            const window = [...(state.window || []), asClose(bar)];
            clampWindow(window, state.period);
            const samples = Number(state.samples || 0) + 1;
            if (window.length < state.period) {
              return { value: null, samples, internalState: { ...state, window, samples } };
            }
            const middle = window.reduce((a: number, b: number) => a + b, 0) / state.period;
            const variance = window.reduce((sum: number, p: number) => sum + (p - middle) ** 2, 0) / state.period;
            const sd = Math.sqrt(variance);
            return {
              value: { upper: middle + sd * state.stdDev, middle, lower: middle - sd * state.stdDev, bb_width: ((sd * 2 * state.stdDev) / middle) * 100 },
              samples,
              internalState: { ...state, window, samples },
            };
          },
        };
      }
      case "obv": {
        return {
          warmUp: (bars) => {
            let obv = 0;
            let prevClose: number | null = null;
            for (const bar of bars) {
              const close = asClose(bar);
              const volume = asVolume(bar);
              if (prevClose == null) obv = volume;
              else obv += close > prevClose ? volume : close < prevClose ? -volume : 0;
              prevClose = close;
            }
            return {
              internalState: { obv, prevClose, samples: bars.length },
              value: obv,
              samples: bars.length,
              lastBarTime: bars.length ? asBarTime(bars[bars.length - 1]) : "",
            };
          },
          update: (state, bar) => {
            const close = asClose(bar);
            const volume = asVolume(bar);
            const obv = state.obv + (close > state.prevClose ? volume : close < state.prevClose ? -volume : 0);
            const samples = Number(state.samples || 0) + 1;
            return { value: obv, samples, internalState: { ...state, obv, prevClose: close, samples } };
          },
        };
      }
      case "vwap": {
        const sessionType = params.session_type || "daily";
        return {
          warmUp: (bars) => {
            let cumTPV = 0;
            let cumVol = 0;
            let prevDate: Date | null = null;
            let value: number | null = null;
            for (const bar of bars) {
              const date = new Date(asBarTime(bar));
              if (prevDate) {
                const reset = sessionType === "daily"
                  ? date.getUTCDate() !== prevDate.getUTCDate() || date.getUTCMonth() !== prevDate.getUTCMonth() || date.getUTCFullYear() !== prevDate.getUTCFullYear()
                  : false;
                if (reset) {
                  cumTPV = 0;
                  cumVol = 0;
                }
              }
              const tp = (asHigh(bar) + asLow(bar) + asClose(bar)) / 3;
              const vol = asVolume(bar);
              cumTPV += tp * vol;
              cumVol += vol;
              value = cumVol > 0 ? cumTPV / cumVol : tp;
              prevDate = date;
            }
            return {
              internalState: { cumTPV, cumVol, prevTime: prevDate?.toISOString() || null, sessionType, samples: bars.length },
              value,
              samples: bars.length,
              lastBarTime: bars.length ? asBarTime(bars[bars.length - 1]) : "",
            };
          },
          update: (state, bar) => {
            let { cumTPV, cumVol } = state;
            const date = new Date(asBarTime(bar));
            const prevDate = state.prevTime ? new Date(state.prevTime) : null;
            const reset = prevDate && state.sessionType === "daily"
              ? date.getUTCDate() !== prevDate.getUTCDate() || date.getUTCMonth() !== prevDate.getUTCMonth() || date.getUTCFullYear() !== prevDate.getUTCFullYear()
              : false;
            if (reset) {
              cumTPV = 0;
              cumVol = 0;
            }
            const tp = (asHigh(bar) + asLow(bar) + asClose(bar)) / 3;
            const vol = asVolume(bar);
            cumTPV += tp * vol;
            cumVol += vol;
            const value = cumVol > 0 ? cumTPV / cumVol : tp;
            const samples = Number(state.samples || 0) + 1;
            return { value, samples, internalState: { ...state, cumTPV, cumVol, prevTime: date.toISOString(), samples } };
          },
        };
      }
      case "adx":
      case "stochastic": {
        if (type === "adx") {
          const period = Number(params.period);
          if (!Number.isFinite(period) || period <= 0) {
            throw createError("period must be a positive number", 400);
          }

          const updateAdx = (state: Record<string, any>, bar: any) => {
            const high = asHigh(bar);
            const low = asLow(bar);
            const close = asClose(bar);
            const samples = Number(state.samples || 0) + 1;

            if (
              !Number.isFinite(high) ||
              !Number.isFinite(low) ||
              !Number.isFinite(close)
            ) {
              return {
                value: state.lastValue ?? null,
                samples,
                internalState: { ...state, samples },
              };
            }

            if (
              !Number.isFinite(state.prevHigh) ||
              !Number.isFinite(state.prevLow) ||
              !Number.isFinite(state.prevClose)
            ) {
              return {
                value: null,
                samples,
                internalState: {
                  ...state,
                  prevHigh: high,
                  prevLow: low,
                  prevClose: close,
                  samples,
                },
              };
            }

            const upMove = high - state.prevHigh;
            const downMove = state.prevLow - low;
            const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
            const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
            const trueRange = Math.max(
              high - low,
              Math.abs(high - state.prevClose),
              Math.abs(low - state.prevClose),
            );

            const next = {
              ...state,
              prevHigh: high,
              prevLow: low,
              prevClose: close,
              samples,
            };

            if (!state.smoothedReady) {
              const seedCount = Number(state.seedCount || 0) + 1;
              const trSeed = Number(state.trSeed || 0) + trueRange;
              const plusDmSeed = Number(state.plusDmSeed || 0) + plusDM;
              const minusDmSeed = Number(state.minusDmSeed || 0) + minusDM;

              if (seedCount < state.period) {
                return {
                  value: null,
                  samples,
                  internalState: {
                    ...next,
                    seedCount,
                    trSeed,
                    plusDmSeed,
                    minusDmSeed,
                  },
                };
              }

              const plusDI = trSeed === 0 ? 0 : (plusDmSeed / trSeed) * 100;
              const minusDI = trSeed === 0 ? 0 : (minusDmSeed / trSeed) * 100;
              const dx = plusDI + minusDI === 0 ? 0 : (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100;

              return {
                value: null,
                samples,
                internalState: {
                  ...next,
                  seedCount,
                  trSeed,
                  plusDmSeed,
                  minusDmSeed,
                  tr14: trSeed,
                  plusDm14: plusDmSeed,
                  minusDm14: minusDmSeed,
                  dxSeedSum: dx,
                  dxSeedCount: 1,
                  smoothedReady: true,
                },
              };
            }

            const tr14 = state.tr14 - state.tr14 / state.period + trueRange;
            const plusDm14 = state.plusDm14 - state.plusDm14 / state.period + plusDM;
            const minusDm14 = state.minusDm14 - state.minusDm14 / state.period + minusDM;
            const plusDI = tr14 === 0 ? 0 : (plusDm14 / tr14) * 100;
            const minusDI = tr14 === 0 ? 0 : (minusDm14 / tr14) * 100;
            const dx = plusDI + minusDI === 0 ? 0 : (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100;

            const dxSeedCount = Number(state.dxSeedCount || 0);
            const dxSeedSum = Number(state.dxSeedSum || 0);

            if (!Number.isFinite(state.adx)) {
              const nextCount = dxSeedCount + 1;
              const nextSum = dxSeedSum + dx;

              if (nextCount < state.period) {
                return {
                  value: null,
                  samples,
                  internalState: {
                    ...next,
                    tr14,
                    plusDm14,
                    minusDm14,
                    dxSeedCount: nextCount,
                    dxSeedSum: nextSum,
                  },
                };
              }

              const adx = nextSum / state.period;
              const out = { adx, pdi: plusDI, mdi: minusDI };

              return {
                value: out,
                samples,
                internalState: {
                  ...next,
                  tr14,
                  plusDm14,
                  minusDm14,
                  dxSeedCount: nextCount,
                  dxSeedSum: nextSum,
                  adx,
                  lastValue: out,
                },
              };
            }

            const adx = (state.adx * (state.period - 1) + dx) / state.period;
            const out = { adx, pdi: plusDI, mdi: minusDI };
            return {
              value: out,
              samples,
              internalState: {
                ...next,
                tr14,
                plusDm14,
                minusDm14,
                adx,
                lastValue: out,
              },
            };
          };

          return {
            warmUp: (bars) => {
              const seedState: Record<string, any> = {
                period,
                samples: 0,
                prevHigh: null,
                prevLow: null,
                prevClose: null,
                seedCount: 0,
                trSeed: 0,
                plusDmSeed: 0,
                minusDmSeed: 0,
                tr14: 0,
                plusDm14: 0,
                minusDm14: 0,
                dxSeedSum: 0,
                dxSeedCount: 0,
                smoothedReady: false,
                adx: null,
                lastValue: null,
              };

              let state = seedState;
              let value: number | Record<string, any> | null = null;
              for (const bar of bars) {
                const result = updateAdx(state, bar);
                value = result.value;
                state = result.internalState;
              }

              return {
                internalState: state,
                value,
                samples: Number(state.samples || bars.length),
                lastBarTime: bars.length ? asBarTime(bars[bars.length - 1]) : "",
              };
            },
            update: (state, bar) => updateAdx(state, bar),
          };
        }

        const period = Number(params.k_period);
        const signalPeriod = Number(params.d_period);
        if (!Number.isFinite(period) || period <= 0) {
          throw createError("k_period must be a positive number", 400);
        }
        if (!Number.isFinite(signalPeriod) || signalPeriod <= 0) {
          throw createError("d_period must be a positive number", 400);
        }

        const updateStochastic = (state: Record<string, any>, bar: any) => {
          const high = asHigh(bar);
          const low = asLow(bar);
          const close = asClose(bar);
          const highs = [...(state.highWindow || []), high];
          const lows = [...(state.lowWindow || []), low];
          clampWindow(highs, state.period);
          clampWindow(lows, state.period);
          const samples = Number(state.samples || 0) + 1;

          if (
            highs.length < state.period ||
            highs.some((v: number) => !Number.isFinite(v)) ||
            lows.some((v: number) => !Number.isFinite(v)) ||
            !Number.isFinite(close)
          ) {
            return {
              value: null,
              samples,
              internalState: { ...state, highWindow: highs, lowWindow: lows, samples },
            };
          }

          const highestHigh = Math.max(...highs);
          const lowestLow = Math.min(...lows);
          const k =
            highestHigh === lowestLow
              ? 0
              : ((close - lowestLow) / (highestHigh - lowestLow)) * 100;

          const kValues = [...(state.kValues || []), k];
          clampWindow(kValues, state.signalPeriod);
          const d = kValues.reduce((sum: number, value: number) => sum + value, 0) / kValues.length;

          const out = { k, d };
          return {
            value: out,
            samples,
            internalState: {
              ...state,
              highWindow: highs,
              lowWindow: lows,
              kValues,
              samples,
              lastValue: out,
            },
          };
        };

        return {
          warmUp: (bars) => {
            let state: Record<string, any> = {
              period,
              signalPeriod,
              highWindow: [],
              lowWindow: [],
              kValues: [],
              samples: 0,
              lastValue: null,
            };
            let value: number | Record<string, any> | null = null;

            for (const bar of bars) {
              const result = updateStochastic(state, bar);
              value = result.value;
              state = result.internalState;
            }

            return {
              internalState: state,
              value,
              samples: Number(state.samples || bars.length),
              lastBarTime: bars.length ? asBarTime(bars[bars.length - 1]) : "",
            };
          },
          update: (state, bar) => updateStochastic(state, bar),
        };
      }
      default:
        throw createError(`Unsupported incremental indicator: ${indicatorType}`, 400);
    }
  }

  static async calculateRSI(input: IndicatorInput): Promise<IndicatorResult> {
    try {
      const {
        prices: rawPrices,
        candle_data: rawCandles,
        period: rawPeriod,
        window: rawWindow,
      } = input;
      const prices = extractPrices(rawPrices, rawCandles);
      const period = Number(rawPeriod || rawWindow);
      if (!Number.isFinite(period) || period <= 0) {
        throw createError(
          "period/window is required and must be a positive number",
          400,
        );
      }

      const rsi = new RSI(period);
      const results: number[] = [];
      for (const price of prices) {
        rsi.update(price, false);
        if (rsi.isStable) {
          const raw = rsi.getResult();
          results.push(toNumber(raw));
        }
      }

      return createSuccessOutput(results, {
        ...INDICATOR_CONTEXT,
        nodeName: "RSI",
      });
    } catch (error) {
      return createErrorOutput(error, {
        ...INDICATOR_CONTEXT,
        nodeName: "RSI",
      });
    }
  }

  static async calculateEMA(input: IndicatorInput): Promise<IndicatorResult> {
    try {
      const {
        prices: rawPrices,
        candle_data: rawCandles,
        window: rawPeriod,
      } = input;
      const prices = extractPrices(rawPrices, rawCandles);
      const period = Number(rawPeriod);
      if (!Number.isFinite(period) || period <= 0) {
        throw createError("period must be a positive number", 400);
      }

      const ema = new EMA(period);
      const results: number[] = [];
      for (const price of prices) {
        ema.update(price, false);
        if (ema.isStable) {
          const raw = ema.getResult();
          results.push(toNumber(raw));
        }
      }

      return createSuccessOutput(results, {
        ...INDICATOR_CONTEXT,
        nodeName: "EMA",
      });
    } catch (error) {
      return createErrorOutput(error, {
        ...INDICATOR_CONTEXT,
        nodeName: "EMA",
      });
    }
  }

  static async calculateSMA(input: IndicatorInput): Promise<IndicatorResult> {
    try {
      const {
        prices: rawPrices,
        candle_data: rawCandles,
        period: rawPeriod,
      } = input;
      const prices = extractPrices(rawPrices, rawCandles);
      const period = Number(rawPeriod);
      if (!Number.isFinite(period) || period <= 0) {
        throw createError(
          "period is required and must be a positive number",
          400,
        );
      }

      const sma = new SMA(period);
      const results: number[] = [];
      for (const price of prices) {
        sma.update(price, false);
        if (sma.isStable) {
          const raw = sma.getResult();
          results.push(toNumber(raw));
        }
      }

      return createSuccessOutput(results, {
        ...INDICATOR_CONTEXT,
        nodeName: "SMA",
      });
    } catch (error) {
      return createErrorOutput(error, {
        ...INDICATOR_CONTEXT,
        nodeName: "SMA",
      });
    }
  }

  static async calculateMACD(input: IndicatorInput): Promise<IndicatorResult> {
    try {
      const {
        prices: rawPrices,
        candle_data: rawCandles,
        fastPeriod: rawFast,
        slowPeriod: rawSlow,
        signalPeriod: rawSignal,
      } = input;
      const prices = extractPrices(rawPrices, rawCandles);
      const fast = Number(rawFast),
        slow = Number(rawSlow),
        signal = Number(rawSignal);
      if ([fast, slow, signal].some((v) => !Number.isFinite(v) || v <= 0)) {
        throw createError("Periods must be positive numbers", 400);
      }

      const macd = new MACD({
        indicator: EMA,
        shortInterval: fast,
        longInterval: slow,
        signalInterval: signal,
      });
      const results: { macd: number; signal: number; histogram: number }[] = [];
      for (const price of prices) {
        macd.update(price, false);
        if (macd.isStable) {
          const r = macd.getResult();
          if (!r) {
            continue;
          }
          results.push({
            macd: toNumber(r.macd),
            signal: toNumber(r.signal),
            histogram: toNumber(r.histogram),
          });
        }
      }

      return createSuccessOutput(results, {
        ...INDICATOR_CONTEXT,
        nodeName: "MACD",
      });
    } catch (error) {
      return createErrorOutput(error, {
        ...INDICATOR_CONTEXT,
        nodeName: "MACD",
      });
    }
  }

  static async calculateBollinger(
    input: IndicatorInput,
  ): Promise<IndicatorResult> {
    try {
      const {
        prices: rawPrices,
        candle_data: rawCandles,
        period: rawPeriod,
        stdDev: rawStd,
        std_dev_multiplier: rawStdMult,
      } = input;
      const prices = extractPrices(rawPrices, rawCandles);
      const period = Number(rawPeriod);
      const stdDev = Number(rawStd || rawStdMult);
      if (!Number.isFinite(period) || period <= 0) {
        throw createError(
          "period is required and must be a positive number",
          400,
        );
      }
      if (!Number.isFinite(stdDev) || stdDev <= 0) {
        throw createError(
          "stdDev/std_dev_multiplier is required and must be a positive number",
          400,
        );
      }

      const bb = new BollingerBands(period, stdDev);
      const results: {
        upper: number;
        middle: number;
        lower: number;
        bb_width: number;
      }[] = [];
      for (const price of prices) {
        bb.update(price, false);
        if (bb.isStable) {
          const r = bb.getResult();
          if (!r) {
            continue;
          }
          results.push({
            upper: toNumber(r.upper),
            middle: toNumber(r.middle),
            lower: toNumber(r.lower),
            bb_width:
              ((toNumber(r.upper) - toNumber(r.lower)) / toNumber(r.middle)) *
              100,
          });
        }
      }

      return createSuccessOutput(results, {
        ...INDICATOR_CONTEXT,
        nodeName: "Bollinger Bands",
      });
    } catch (error) {
      return createErrorOutput(error, {
        ...INDICATOR_CONTEXT,
        nodeName: "Bollinger Bands",
      });
    }
  }

  static async calculateADX(input: IndicatorInput): Promise<IndicatorResult> {
    try {
      const { candle_data: rawCandles, period: rawPeriod } = input;
      const candles = parseArray<any>(rawCandles, "candle_data");
      const period = Number(rawPeriod);
      if (!Number.isFinite(period) || period <= 0) {
        throw createError(
          "period is required and must be a positive number",
          400,
        );
      }

      const high = candles.map((c) => Number(c.h ?? c.high));
      const low = candles.map((c) => Number(c.l ?? c.low));
      const close = candles.map((c) => Number(c.c ?? c.close));
      if ([...high, ...low, ...close].some((v) => !Number.isFinite(v))) {
        throw createError("Invalid numeric value in candles", 400);
      }

      const results = ADX.calculate({ high, low, close, period });
      return createSuccessOutput(results, {
        ...INDICATOR_CONTEXT,
        nodeName: "ADX",
      });
    } catch (error) {
      return createErrorOutput(error, {
        ...INDICATOR_CONTEXT,
        nodeName: "ADX",
      });
    }
  }

  static async calculateStochastic(
    input: IndicatorInput,
  ): Promise<IndicatorResult> {
    try {
      const { candle_data: rawCandles, k_period: rawK, d_period: rawD } = input;
      const candles = parseArray<any>(rawCandles, "candle_data");
      const periodK = Number(rawK);
      const periodD = Number(rawD);
      if (!Number.isFinite(periodK) || periodK <= 0) {
        throw createError(
          "k_period is required and must be a positive number",
          400,
        );
      }
      if (!Number.isFinite(periodD) || periodD <= 0) {
        throw createError(
          "d_period is required and must be a positive number",
          400,
        );
      }

      const high = candles.map((c) => Number(c.h ?? c.high));
      const low = candles.map((c) => Number(c.l ?? c.low));
      const close = candles.map((c) => Number(c.c ?? c.close));

      const results = Stochastic.calculate({
        high,
        low,
        close,
        period: periodK,
        signalPeriod: periodD,
      });
      return createSuccessOutput(results, {
        ...INDICATOR_CONTEXT,
        nodeName: "Stochastic",
      });
    } catch (error) {
      return createErrorOutput(error, {
        ...INDICATOR_CONTEXT,
        nodeName: "Stochastic",
      });
    }
  }

  static async calculateIchimoku(
    input: IndicatorInput,
  ): Promise<IndicatorResult> {
    try {
      const {
        candle_data: rawCandles,
        conversion_period: rawConv,
        base_period: rawBase,
        leading_span_b_period: rawSpan,
        displacement: rawDisp,
      } = input;
      const candles = parseArray<any>(rawCandles, "candle_data");
      const conv = Number(rawConv);
      const base = Number(rawBase);
      const span = Number(rawSpan);
      const disp = Number(rawDisp);
      if ([conv, base, span, disp].some((v) => !Number.isFinite(v) || v <= 0)) {
        throw createError(
          "All Ichimoku periods are required and must be positive numbers",
          400,
        );
      }

      const high = candles.map((c) => Number(c.h ?? c.high));
      const low = candles.map((c) => Number(c.l ?? c.low));

      const results = IchimokuCloud.calculate({
        high,
        low,
        conversionPeriod: conv,
        basePeriod: base,
        spanPeriod: span,
        displacement: disp,
      });
      return createSuccessOutput(results, {
        ...INDICATOR_CONTEXT,
        nodeName: "Ichimoku",
      });
    } catch (error) {
      return createErrorOutput(error, {
        ...INDICATOR_CONTEXT,
        nodeName: "Ichimoku",
      });
    }
  }

  static async calculateOBV(input: IndicatorInput): Promise<IndicatorResult> {
    try {
      const { candle_data: rawCandles } = input;
      const candles = parseArray<any>(rawCandles, "candle_data");
      const obvValues: { timestamp: string; obv: number }[] = [];
      let obv = 0;

      candles.forEach((c, i) => {
        const close = Number(c.c ?? c.close),
          volume = Number(c.v ?? c.volume);
        if (!Number.isFinite(close) || !Number.isFinite(volume)) {
          throw createError(
            "Each candle must have numeric close and volume",
            400,
          );
        }

        if (i === 0) obv = volume;
        else {
          const prevClose = Number(candles[i - 1].c ?? candles[i - 1].close);
          obv += close > prevClose ? volume : close < prevClose ? -volume : 0;
        }
        obvValues.push({ timestamp: c.t ?? c.timestamp, obv });
      });

      return createSuccessOutput(obvValues, {
        ...INDICATOR_CONTEXT,
        nodeName: "OBV",
      });
    } catch (error) {
      return createErrorOutput(error, {
        ...INDICATOR_CONTEXT,
        nodeName: "OBV",
      });
    }
  }

  static async calculateVWAP(input: IndicatorInput): Promise<IndicatorResult> {
    try {
      const {
        candle_data: rawCandles,
        session_type = "daily",
        custom_start_time,
      } = input;
      const candles = parseArray<any>(rawCandles, "candle_data");
      const vwapValues: {
        timestamp: string;
        vwap: number;
        sessionStart: number;
      }[] = [];
      let cumTPV = 0,
        cumVol = 0,
        sessionStartIdx = 0;

      candles.forEach((c, i) => {
        const high = Number(c.h ?? c.high),
          low = Number(c.l ?? c.low),
          close = Number(c.c ?? c.close),
          volume = Number(c.v ?? c.volume);
        if (![high, low, close, volume].every(Number.isFinite)) {
          throw createError(
            "Each candle must have numeric high, low, close, and volume",
            400,
          );
        }

        const tp = (high + low + close) / 3;
        let reset = false;
        const curr = new Date(c.t ?? c.timestamp);
        if (i > 0) {
          const prev = new Date(candles[i - 1].t ?? candles[i - 1].timestamp);
          if (session_type === "daily") {
            reset = curr.getDate() !== prev.getDate();
          } else if (session_type === "weekly") {
            reset =
              Math.floor(curr.getTime() / (7 * 24 * 60 * 60 * 1000)) !==
              Math.floor(prev.getTime() / (7 * 24 * 60 * 60 * 1000));
          } else if (session_type === "custom" && custom_start_time) {
            reset = curr < new Date(custom_start_time);
          }
        }
        if (reset || i === 0) {
          cumTPV = 0;
          cumVol = 0;
          sessionStartIdx = i;
        }

        cumTPV += tp * volume;
        cumVol += volume;
        const vwap = cumVol > 0 ? cumTPV / cumVol : tp;
        vwapValues.push({
          timestamp: c.t ?? c.timestamp,
          vwap,
          sessionStart: sessionStartIdx,
        });
      });

      return createSuccessOutput(vwapValues, {
        ...INDICATOR_CONTEXT,
        nodeName: "VWAP",
      });
    } catch (error) {
      return createErrorOutput(error, {
        ...INDICATOR_CONTEXT,
        nodeName: "VWAP",
      });
    }
  }

  static async calculateVolumeOscillator(
    input: IndicatorInput,
  ): Promise<IndicatorResult> {
    try {
      const {
        candle_data: rawCandles,
        short_period,
        long_period,
        type,
      } = input;

      const candles = parseArray<any>(rawCandles, "candle_data");
      const shortP = Number(short_period);
      const longP = Number(long_period);

      if (
        !Number.isFinite(shortP) ||
        !Number.isFinite(longP) ||
        shortP <= 0 ||
        longP <= 0
      ) {
        throw createError("Invalid periods", 400);
      }
      if (shortP >= longP) {
        throw createError("short_period must be less than long_period", 400);
      }

      const volumes = candles.map((c) => Number(c.v ?? c.volume));
      if (volumes.some((v) => !Number.isFinite(v) || v < 0)) {
        throw createError("Invalid volume data", 400);
      }

      const alphaShort = 2 / (shortP + 1);
      const alphaLong = 2 / (longP + 1);

      let shortEMA = volumes[0];
      let longEMA = volumes[0];

      const out: number[] = [];

      for (let i = 1; i < volumes.length; i++) {
        shortEMA = volumes[i] * alphaShort + shortEMA * (1 - alphaShort);
        longEMA = volumes[i] * alphaLong + longEMA * (1 - alphaLong);

        if (i + 1 >= longP) {
          out.push(
            type === "percentage"
              ? ((shortEMA - longEMA) / longEMA) * 100
              : shortEMA - longEMA,
          );
        }
      }

      return createSuccessOutput(out, {
        ...INDICATOR_CONTEXT,
        nodeName: "Volume Oscillator",
      });
    } catch (error) {
      return createErrorOutput(error, {
        ...INDICATOR_CONTEXT,
        nodeName: "Volume Oscillator",
      });
    }
  }

  static async calculateSupportResistancePivot(
    input: IndicatorInput,
  ): Promise<IndicatorResult> {
    try {
      const { candle_data: rawCandles, num_levels } = input;
      const candles = parseArray<any>(rawCandles, "candle_data");

      if (!num_levels) throw createError("num_levels is required", 400);
      if (candles.length === 0)
        throw createError("No candle data provided", 400);

      const lastCandle = candles[candles.length - 1];
      const high = Number(lastCandle.h ?? lastCandle.high);
      const low = Number(lastCandle.l ?? lastCandle.low);
      const close = Number(lastCandle.c ?? lastCandle.close);

      if (
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        throw createError("Invalid OHLC data in last candle", 400);
      }

      const PP = (high + low + close) / 3;

      const levels = {
        pivot: PP,
        resistance: [] as number[],
        support: [] as number[],
      };

      const numLevels = Math.min(Number(num_levels), 5);

      if (numLevels >= 1) {
        levels.resistance.push(2 * PP - low);
        levels.support.push(2 * PP - high);
      }
      if (numLevels >= 2) {
        levels.resistance.push(PP + (high - low));
        levels.support.push(PP - (high - low));
      }
      if (numLevels >= 3) {
        levels.resistance.push(high + 2 * (PP - low));
        levels.support.push(low - 2 * (high - PP));
      }

      return createSuccessOutput([levels], {
        ...INDICATOR_CONTEXT,
        nodeName: "Support/Resistance Pivot",
      });
    } catch (error) {
      return createErrorOutput(error, {
        ...INDICATOR_CONTEXT,
        nodeName: "Support/Resistance Pivot",
      });
    }
  }

  static async calculateSupportResistanceSwing(
    input: IndicatorInput,
  ): Promise<IndicatorResult> {
    try {
      const {
        candle_data: rawCandles,
        lookback_period,
        sensitivity,
        num_levels,
      } = input;

      const candles = parseArray<any>(rawCandles, "candle_data");

      if (!lookback_period)
        throw createError("lookback_period is required", 400);
      if (!sensitivity) throw createError("sensitivity is required", 400);
      if (!num_levels) throw createError("num_levels is required", 400);

      const lookback = Number(lookback_period);
      const sens = Number(sensitivity) / 100;
      const numLevels = Math.min(Number(num_levels), 5);

      if (candles.length < lookback) {
        throw createError(`Need at least ${lookback} candles`, 400);
      }

      const recentCandles = candles.slice(-lookback);
      const highs = recentCandles.map((c: any) => Number(c.h ?? c.high));
      const lows = recentCandles.map((c: any) => Number(c.l ?? c.low));

      const swingHighs: number[] = [];
      for (let i = 2; i < highs.length - 2; i++) {
        if (
          highs[i] > highs[i - 1] &&
          highs[i] > highs[i - 2] &&
          highs[i] > highs[i + 1] &&
          highs[i] > highs[i + 2]
        ) {
          swingHighs.push(highs[i]);
        }
      }

      const swingLows: number[] = [];
      for (let i = 2; i < lows.length - 2; i++) {
        if (
          lows[i] < lows[i - 1] &&
          lows[i] < lows[i - 2] &&
          lows[i] < lows[i + 1] &&
          lows[i] < lows[i + 2]
        ) {
          swingLows.push(lows[i]);
        }
      }

      const clusterLevels = (prices: number[]): number[] => {
        if (prices.length === 0) return [];

        prices.sort((a, b) => a - b);
        const clusters: number[][] = [[prices[0]]];

        for (let i = 1; i < prices.length; i++) {
          const lastCluster = clusters[clusters.length - 1];
          const lastPrice = lastCluster[lastCluster.length - 1];

          if (Math.abs(prices[i] - lastPrice) / lastPrice <= sens) {
            lastCluster.push(prices[i]);
          } else {
            clusters.push([prices[i]]);
          }
        }

        return clusters
          .sort((a, b) => b.length - a.length)
          .slice(0, numLevels)
          .map(
            (cluster) =>
              cluster.reduce((sum, p) => sum + p, 0) / cluster.length,
          )
          .sort((a, b) => b - a);
      };

      const resistanceLevels = clusterLevels(swingHighs);
      const supportLevels = clusterLevels(swingLows).reverse();

      const levels = {
        resistance: resistanceLevels,
        support: supportLevels,
        swing_highs_count: swingHighs.length,
        swing_lows_count: swingLows.length,
      };

      return createSuccessOutput([levels], {
        ...INDICATOR_CONTEXT,
        nodeName: "Support/Resistance Swing",
      });
    } catch (error) {
      return createErrorOutput(error, {
        ...INDICATOR_CONTEXT,
        nodeName: "Support/Resistance Swing",
      });
    }
  }

  static async calculateSupportResistanceHistorical(
    input: IndicatorInput,
  ): Promise<IndicatorResult> {
    try {
      const { candle_data: rawCandles, lookback_period, num_levels } = input;
      const candles = parseArray<any>(rawCandles, "candle_data");

      if (!lookback_period)
        throw createError("lookback_period is required", 400);
      if (!num_levels) throw createError("num_levels is required", 400);

      const lookback = Number(lookback_period);
      const numLevels = Math.min(Number(num_levels), 5);

      if (candles.length < lookback) {
        throw createError(`Need at least ${lookback} candles`, 400);
      }

      const recentCandles = candles.slice(-lookback);
      const highs = recentCandles.map((c: any) => Number(c.h ?? c.high));
      const lows = recentCandles.map((c: any) => Number(c.l ?? c.low));

      const sortedHighs = [...highs].sort((a, b) => b - a);
      const sortedLows = [...lows].sort((a, b) => a - b);

      const resistanceLevels = sortedHighs.slice(0, numLevels);
      const supportLevels = sortedLows.slice(0, numLevels);

      const levels = {
        resistance: resistanceLevels,
        support: supportLevels,
        highest_high: Math.max(...highs),
        lowest_low: Math.min(...lows),
      };

      return createSuccessOutput([levels], {
        ...INDICATOR_CONTEXT,
        nodeName: "Support/Resistance Historical",
      });
    } catch (error) {
      return createErrorOutput(error, {
        ...INDICATOR_CONTEXT,
        nodeName: "Support/Resistance Historical",
      });
    }
  }

  static async calculate(
    indicatorType: string,
    input: IndicatorInput,
  ): Promise<IndicatorResult> {
    switch (indicatorType.toLowerCase()) {
      case "rsi":
        return this.calculateRSI(input);
      case "ema":
        return this.calculateEMA(input);
      case "sma":
        return this.calculateSMA(input);
      case "macd":
        return this.calculateMACD(input);
      case "bollinger bands":
        return this.calculateBollinger(input);
      case "adx":
        return this.calculateADX(input);
      case "stochastic":
        return this.calculateStochastic(input);
      case "ichimoku":
        return this.calculateIchimoku(input);
      case "obv":
        return this.calculateOBV(input);
      case "vwap":
        return this.calculateVWAP(input);
      case "volume-oscillator":
      case "volumeoscillator":
        return this.calculateVolumeOscillator(input);
      case "support-resistance":
      case "support & resistance":
      case "supportresistance":
        const method = input.method?.toLowerCase();
        if (!method) {
          return createErrorOutput(
            createError(
              "method is required (pivot, swing, or historical)",
              400,
            ),
            INDICATOR_CONTEXT,
          );
        }
        switch (method) {
          case "pivot":
            return this.calculateSupportResistancePivot(input);
          case "swing":
            return this.calculateSupportResistanceSwing(input);
          case "historical":
            return this.calculateSupportResistanceHistorical(input);
          default:
            return createErrorOutput(
              createError(`Unsupported S&R method: ${method}`, 400),
              INDICATOR_CONTEXT,
            );
        }
      default:
        return createErrorOutput(
          createError(`Unsupported indicator: ${indicatorType}`, 400),
          INDICATOR_CONTEXT,
        );
    }
  }
}
