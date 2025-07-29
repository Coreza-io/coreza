// src/services/IndicatorService.ts

import { RSI, EMA, SMA, MACD, BollingerBands } from 'trading-signals';
import { ADX, Stochastic, IchimokuCloud } from 'technicalindicators';
import Big from 'big.js';
import { createError } from '../middleware/errorHandler';

export interface IndicatorInput {
  prices?: any;
  candle_data?: any;
  period?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  stdDev?: number;
  k_period?: number;
  d_period?: number;
  conversion_period?: number;
  base_period?: number;
  leading_span_b_period?: number;
  displacement?: number;
  session_type?: string;
  custom_start_time?: string;
}

export interface IndicatorResult {
  success: boolean;
  indicator: string;
  period?: number;
  periods?: any;
  values: any[];
  latest: any;
  sessionType?: string;
  stdDev?: number;
  count?: number;
}

// Helper to parse JSON string arrays
function parseArray<T>(raw: any, fieldName: string): T[] {
  if (raw == null) throw createError(`${fieldName} is required`, 400);
  let arr: any;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      throw createError(`Invalid JSON in ${fieldName}`, 400);
    }
  } else {
    arr = raw;
  }
  if (!Array.isArray(arr)) throw createError(`${fieldName} must be an array`, 400);
  return arr;
}

// Helper to extract close prices (supports raw numbers or candle objects)
function extractPrices(rawPrices: any, rawCandles: any): number[] {
  const dataField = rawPrices != null ? 'prices' : 'candle_data';
  const raw = rawPrices != null ? rawPrices : rawCandles;
  const arr = parseArray<any>(raw, dataField);
  const values: number[] = arr
    .map(item => {
      if (typeof item === 'object') {
        const val = item.c ?? item.close;
        return Number(val);
      }
      return Number(item);
    })
    .filter(v => Number.isFinite(v));
  if (values.length === 0) throw createError('No valid numeric prices found', 400);
  return values;
}

// Helper to normalize Big.js instances (and any other value) to plain number
function toNumber(raw: any): number {
  if (raw instanceof Big) {
    return parseFloat(raw.toString());
  }
  return Number(raw);
}

export class IndicatorService {
  static async calculateRSI(input: IndicatorInput): Promise<IndicatorResult> {
    const { prices: rawPrices, candle_data: rawCandles, period: rawPeriod = 14 } = input;
    const prices = extractPrices(rawPrices, rawCandles);
    const period = Number(rawPeriod);
    if (!Number.isFinite(period) || period <= 0) {
      throw createError('period must be a positive number', 400);
    }

    const rsi = new RSI(period);
    const results: number[] = [];
    for (const price of prices) {
      rsi.update(price);
      if (rsi.isStable) {
        const raw = rsi.getResult();
        results.push(toNumber(raw));
      }
    }

    const latest = results.length > 0 ? results[results.length - 1] : null;
    return { success: true, indicator: 'RSI', period, values: results, latest };
  }

  static async calculateEMA(input: IndicatorInput): Promise<IndicatorResult> {
    const { prices: rawPrices, candle_data: rawCandles, period: rawPeriod = 14 } = input;
    const prices = extractPrices(rawPrices, rawCandles);
    const period = Number(rawPeriod);
    if (!Number.isFinite(period) || period <= 0) {
      throw createError('period must be a positive number', 400);
    }

    const ema = new EMA(period);
    const results: number[] = [];
    for (const price of prices) {
      ema.update(price);
      if (ema.isStable) {
        const raw = ema.getResult();
        results.push(toNumber(raw));
      }
    }

    const latest = results.length > 0 ? results[results.length - 1] : null;
    return { success: true, indicator: 'EMA', period, values: results, latest };
  }

  static async calculateSMA(input: IndicatorInput): Promise<IndicatorResult> {
    const { prices: rawPrices, candle_data: rawCandles, period: rawPeriod = 20 } = input;
    const prices = extractPrices(rawPrices, rawCandles);
    const period = Number(rawPeriod);
    if (!Number.isFinite(period) || period <= 0) {
      throw createError('period must be a positive number', 400);
    }

    const sma = new SMA(period);
    const results: number[] = [];
    for (const price of prices) {
      sma.update(price);
      if (sma.isStable) {
        const raw = sma.getResult();
        results.push(toNumber(raw));
      }
    }

    const latest = results.length > 0 ? results[results.length - 1] : null;
    return { success: true, indicator: 'SMA', period, values: results, latest };
  }

  static async calculateMACD(input: IndicatorInput): Promise<IndicatorResult> {
    const {
      prices: rawPrices,
      candle_data: rawCandles,
      fastPeriod: rawFast = 12,
      slowPeriod: rawSlow = 26,
      signalPeriod: rawSignal = 9
    } = input;
    const prices = extractPrices(rawPrices, rawCandles);
    const fast = Number(rawFast),
      slow = Number(rawSlow),
      signal = Number(rawSignal);
    if ([fast, slow, signal].some(v => !Number.isFinite(v) || v <= 0)) {
      throw createError('Periods must be positive numbers', 400);
    }

    const macd = new MACD({ indicator: EMA, short: fast, long: slow, signal });
    const results: { macd: number; signal: number; histogram: number }[] = [];
    for (const price of prices) {
      macd.update(price);
      if (macd.isStable) {
        const r = macd.getResult();
        results.push({
          macd: toNumber(r.macd),
          signal: toNumber(r.signal),
          histogram: toNumber(r.histogram)
        });
      }
    }

    const latest = results.length > 0 ? results[results.length - 1] : null;
    return {
      success: true,
      indicator: 'MACD',
      periods: { fast, slow, signal },
      values: results,
      latest
    };
  }

  static async calculateBollinger(input: IndicatorInput): Promise<IndicatorResult> {
    const {
      prices: rawPrices,
      candle_data: rawCandles,
      period: rawPeriod = 20,
      stdDev: rawStd = 2
    } = input;
    const prices = extractPrices(rawPrices, rawCandles);
    const period = Number(rawPeriod),
      stdDev = Number(rawStd);
    if (!Number.isFinite(period) || period <= 0) {
      throw createError('period must be a positive number', 400);
    }
    if (!Number.isFinite(stdDev) || stdDev <= 0) {
      throw createError('stdDev must be a positive number', 400);
    }

    const bb = new BollingerBands(period, stdDev);
    const results: { upper: number; middle: number; lower: number }[] = [];
    for (const price of prices) {
      bb.update(price);
      if (bb.isStable) {
        const r = bb.getResult();
        results.push({
          upper: toNumber(r.upper),
          middle: toNumber(r.middle),
          lower: toNumber(r.lower)
        });
      }
    }

    const latest = results.length > 0 ? results[results.length - 1] : null;
    return {
      success: true,
      indicator: 'BollingerBands',
      period,
      stdDev,
      values: results,
      latest
    };
  }

  static async calculateADX(input: IndicatorInput): Promise<IndicatorResult> {
    const { candle_data: rawCandles, period: rawPeriod = 14 } = input;
    const candles = parseArray<any>(rawCandles, 'candle_data');
    const period = Number(rawPeriod);
    if (!Number.isFinite(period) || period <= 0) {
      throw createError('period must be a positive number', 400);
    }

    const high = candles.map(c => Number(c.h ?? c.high));
    const low = candles.map(c => Number(c.l ?? c.low));
    const close = candles.map(c => Number(c.c ?? c.close));
    if ([...high, ...low, ...close].some(v => !Number.isFinite(v))) {
      throw createError('Invalid numeric value in candles', 400);
    }

    const adxResult = ADX.calculate({ high, low, close, period });
    const latest = adxResult.length > 0 ? adxResult[adxResult.length - 1] : null;
    return {
      success: true,
      indicator: 'ADX',
      period,
      values: adxResult,
      latest
    };
  }

  static async calculateStochastic(input: IndicatorInput): Promise<IndicatorResult> {
    const { candle_data: rawCandles, k_period: rawK = 14, d_period: rawD = 3 } = input;
    const candles = parseArray<any>(rawCandles, 'candle_data');
    const periodK = Number(rawK),
      periodD = Number(rawD);
    if ([periodK, periodD].some(v => !Number.isFinite(v) || v <= 0)) {
      throw createError('k_period and d_period must be positive numbers', 400);
    }

    const high = candles.map(c => Number(c.h ?? c.high));
    const low = candles.map(c => Number(c.l ?? c.low));
    const close = candles.map(c => Number(c.c ?? c.close));

    const stochResult = Stochastic.calculate({
      high,
      low,
      close,
      period: periodK,
      signalPeriod: periodD
    });
    const latest = stochResult.length > 0 ? stochResult[stochResult.length - 1] : null;
    return {
      success: true,
      indicator: 'Stochastic',
      periods: { k: periodK, d: periodD },
      values: stochResult,
      latest
    };
  }

  static async calculateIchimoku(input: IndicatorInput): Promise<IndicatorResult> {
    const {
      candle_data: rawCandles,
      conversion_period: rawConv = 9,
      base_period: rawBase = 26,
      leading_span_b_period: rawSpan = 52,
      displacement: rawDisp = 26
    } = input;
    const candles = parseArray<any>(rawCandles, 'candle_data');
    const conv = Number(rawConv),
      base = Number(rawBase),
      span = Number(rawSpan),
      disp = Number(rawDisp);
    if ([conv, base, span, disp].some(v => !Number.isFinite(v) || v <= 0)) {
      throw createError('All periods must be positive numbers', 400);
    }

    const high = candles.map(c => Number(c.h ?? c.high));
    const low = candles.map(c => Number(c.l ?? c.low));

    const ichResult = IchimokuCloud.calculate({
      high,
      low,
      conversionPeriod: conv,
      basePeriod: base,
      spanPeriod: span,
      displacement: disp
    });
    const latest = ichResult.length > 0 ? ichResult[ichResult.length - 1] : null;
    return {
      success: true,
      indicator: 'IchimokuCloud',
      periods: { conversion: conv, base, span_b: span, displacement: disp },
      values: ichResult,
      latest
    };
  }

  static async calculateOBV(input: IndicatorInput): Promise<IndicatorResult> {
    const { candle_data: rawCandles } = input;
    const candles = parseArray<any>(rawCandles, 'candle_data');
    const obvValues: { timestamp: string; obv: number }[] = [];
    let obv = 0;

    candles.forEach((c, i) => {
      const close = Number(c.c ?? c.close),
        volume = Number(c.v ?? c.volume);
      if (!Number.isFinite(close) || !Number.isFinite(volume)) {
        throw createError('Each candle must have numeric close and volume', 400);
      }

      if (i === 0) obv = volume;
      else {
        const prevClose = Number(candles[i - 1].c ?? candles[i - 1].close);
        obv += close > prevClose ? volume : close < prevClose ? -volume : 0;
      }
      obvValues.push({ timestamp: c.t ?? c.timestamp, obv });
    });

    const latest = obvValues.length > 0 ? obvValues[obvValues.length - 1] : null;
    return {
      success: true,
      indicator: 'OBV',
      values: obvValues,
      latest,
      count: obvValues.length
    };
  }

  static async calculateVWAP(input: IndicatorInput): Promise<IndicatorResult> {
    const { candle_data: rawCandles, session_type = 'daily', custom_start_time } = input;
    const candles = parseArray<any>(rawCandles, 'candle_data');
    const vwapValues: { timestamp: string; vwap: number; sessionStart: number }[] = [];
    let cumTPV = 0,
      cumVol = 0,
      sessionStartIdx = 0;

    candles.forEach((c, i) => {
      const high = Number(c.h ?? c.high),
        low = Number(c.l ?? c.low),
        close = Number(c.c ?? c.close),
        volume = Number(c.v ?? c.volume);
      if (![high, low, close, volume].every(Number.isFinite)) {
        throw createError('Each candle must have numeric high, low, close, and volume', 400);
      }

      const tp = (high + low + close) / 3;
      let reset = false;
      const curr = new Date(c.t ?? c.timestamp);
      if (i > 0) {
        const prev = new Date(candles[i - 1].t ?? candles[i - 1].timestamp);
        if (session_type === 'daily') {
          reset = curr.getDate() !== prev.getDate();
        } else if (session_type === 'weekly') {
          reset =
            Math.floor(curr.getTime() / (7 * 24 * 60 * 60 * 1000)) !==
            Math.floor(prev.getTime() / (7 * 24 * 60 * 60 * 1000));
        } else if (session_type === 'custom' && custom_start_time) {
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
      vwapValues.push({ timestamp: c.t ?? c.timestamp, vwap, sessionStart: sessionStartIdx });
    });

    const latest = vwapValues.length > 0 ? vwapValues[vwapValues.length - 1] : null;
    return {
      success: true,
      indicator: 'VWAP',
      sessionType: session_type,
      values: vwapValues,
      latest,
      count: vwapValues.length
    };
  }

  static async calculate(indicatorType: string, input: IndicatorInput): Promise<IndicatorResult> {
    switch (indicatorType.toLowerCase()) {
      case 'rsi':
        return this.calculateRSI(input);
      case 'ema':
        return this.calculateEMA(input);
      case 'sma':
        return this.calculateSMA(input);
      case 'macd':
        return this.calculateMACD(input);
      case 'bollinger':
        return this.calculateBollinger(input);
      case 'adx':
        return this.calculateADX(input);
      case 'stochastic':
        return this.calculateStochastic(input);
      case 'ichimoku':
        return this.calculateIchimoku(input);
      case 'obv':
        return this.calculateOBV(input);
      case 'vwap':
        return this.calculateVWAP(input);
      default:
        throw createError(`Unsupported indicator: ${indicatorType}`, 400);
    }
  }
}
