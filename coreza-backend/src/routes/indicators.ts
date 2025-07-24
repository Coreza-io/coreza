import express from 'express';
import { RSI, EMA, SMA, MACD, BollingerBands } from 'trading-signals';
import { ADX, Stochastic, IchimokuCloud } from 'technicalindicators';
import { createError } from '../middleware/errorHandler';

const router = express.Router();

// Helper to parse JSON string arrays
function parseArray<T>(raw: any, fieldName: string): T[] {
  if (raw == null) throw createError(`${fieldName} is required`, 400);
  let arr: any;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); }
    catch { throw createError(`Invalid JSON in ${fieldName}`, 400); }
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
  const values: number[] = arr.map(item => {
    if (typeof item === 'object') {
      const val = item.c ?? item.close;
      return Number(val);
    }
    return Number(item);
  }).filter(v => Number.isFinite(v));
  if (values.length === 0) throw createError('No valid numeric prices found', 400);
  return values;
}

// RSI endpoint
router.post('/rsi', async (req, res, next) => {
  try {
    const { prices: rawPrices, candle_data: rawCandles, period: rawPeriod = 14 } = req.body;
    const prices = extractPrices(rawPrices, rawCandles);
    const period = Number(rawPeriod);
    if (!Number.isFinite(period) || period <= 0) throw createError('period must be a positive number', 400);

    const rsi = new RSI(period);
    const results: number[] = [];
    for (const price of prices) {
      rsi.update(price);
      if (rsi.isStable) results.push(rsi.getResult());
    }

    res.json({ indicator: 'RSI', period, values: results, latest: results.pop() ?? null });
  } catch (error) {
    next(error);
  }
});

// EMA endpoint
router.post('/ema', async (req, res, next) => {
  try {
    const { prices: rawPrices, candle_data: rawCandles, period: rawPeriod = 14 } = req.body;
    const prices = extractPrices(rawPrices, rawCandles);
    const period = Number(rawPeriod);
    if (!Number.isFinite(period) || period <= 0) throw createError('period must be a positive number', 400);

    const ema = new EMA(period);
    const results: number[] = [];
    for (const price of prices) {
      ema.update(price);
      if (ema.isStable) results.push(ema.getResult());
    }

    res.json({ indicator: 'EMA', period, values: results, latest: results.pop() ?? null });
  } catch (error) {
    next(error);
  }
});

// SMA endpoint
router.post('/sma', async (req, res, next) => {
  try {
    const { prices: rawPrices, candle_data: rawCandles, period: rawPeriod = 20 } = req.body;
    const prices = extractPrices(rawPrices, rawCandles);
    const period = Number(rawPeriod);
    if (!Number.isFinite(period) || period <= 0) throw createError('period must be a positive number', 400);

    const sma = new SMA(period);
    const results: number[] = [];
    for (const price of prices) {
      sma.update(price);
      if (sma.isStable) results.push(sma.getResult());
    }

    res.json({ indicator: 'SMA', period, values: results, latest: results.pop() ?? null });
  } catch (error) {
    next(error);
  }
});

// MACD endpoint
router.post('/macd', async (req, res, next) => {
  try {
    const { prices: rawPrices, candle_data: rawCandles, fastPeriod: rawFast = 12, slowPeriod: rawSlow = 26, signalPeriod: rawSignal = 9 } = req.body;
    const prices = extractPrices(rawPrices, rawCandles);
    const fast = Number(rawFast), slow = Number(rawSlow), signal = Number(rawSignal);
    if ([fast, slow, signal].some(v => !Number.isFinite(v) || v <= 0)) throw createError('Periods must be positive numbers', 400);

    const macd = new MACD({ indicator: EMA, short: fast, long: slow, signal });
    const results: { macd: number; signal: number; histogram: number }[] = [];
    for (const price of prices) {
      macd.update(price);
      if (macd.isStable) {
        const r = macd.getResult();
        results.push({ macd: r.macd, signal: r.signal, histogram: r.histogram });
      }
    }

    res.json({ indicator: 'MACD', periods: { fast, slow, signal }, values: results, latest: results.pop() ?? null });
  } catch (error) {
    next(error);
  }
});

// Bollinger Bands endpoint
router.post('/bollinger', async (req, res, next) => {
  try {
    const { prices: rawPrices, candle_data: rawCandles, period: rawPeriod = 20, stdDev: rawStd = 2 } = req.body;
    const prices = extractPrices(rawPrices, rawCandles);
    const period = Number(rawPeriod), stdDev = Number(rawStd);
    if (!Number.isFinite(period) || period <= 0) throw createError('period must be a positive number', 400);
    if (!Number.isFinite(stdDev) || stdDev <= 0) throw createError('stdDev must be a positive number', 400);

    const bb = new BollingerBands(period, stdDev);
    const results: { upper: number; middle: number; lower: number }[] = [];
    for (const price of prices) {
      bb.update(price);
      if (bb.isStable) {
        const r = bb.getResult();
        results.push({ upper: r.upper, middle: r.middle, lower: r.lower });
      }
    }

    res.json({ indicator: 'BollingerBands', period, stdDev, values: results, latest: results.pop() ?? null });
  } catch (error) {
    next(error);
  }
});

// ADX endpoint
router.post('/adx', async (req, res, next) => {
  try {
    const { candle_data: rawCandles, period: rawPeriod = 14 } = req.body;
    const candles = parseArray<any>(rawCandles, 'candle_data');
    const period = Number(rawPeriod);
    if (!Number.isFinite(period) || period <= 0) throw createError('period must be a positive number', 400);

    const high = candles.map(c => Number(c.h ?? c.high));
    const low = candles.map(c => Number(c.l ?? c.low));
    const close = candles.map(c => Number(c.c ?? c.close));
    if ([...high, ...low, ...close].some(v => !Number.isFinite(v))) throw createError('Invalid numeric value in candles', 400);

    const adxResult = ADX.calculate({ high, low, close, period });
    res.json({ indicator: 'ADX', period, values: adxResult, latest: adxResult.pop() ?? null });
  } catch (error) {
    next(error);
  }
});

// Stochastic Oscillator endpoint
router.post('/stochastic', async (req, res, next) => {
  try {
    const { candle_data: rawCandles, k_period: rawK = 14, d_period: rawD = 3 } = req.body;
    const candles = parseArray<any>(rawCandles, 'candle_data');
    const periodK = Number(rawK), periodD = Number(rawD);
    if ([periodK, periodD].some(v => !Number.isFinite(v) || v <= 0)) throw createError('k_period and d_period must be positive numbers', 400);

    const high = candles.map(c => Number(c.h ?? c.high));
    const low = candles.map(c => Number(c.l ?? c.low));
    const close = candles.map(c => Number(c.c ?? c.close));

    const stochResult = Stochastic.calculate({ high, low, close, period: periodK, signalPeriod: periodD });
    res.json({ indicator: 'Stochastic', periods: { k: periodK, d: periodD }, values: stochResult, latest: stochResult.pop() ?? null });
  } catch (error) {
    next(error);
  }
});

// Ichimoku Cloud endpoint
router.post('/ichimoku', async (req, res, next) => {
  try {
    const { candle_data: rawCandles, conversion_period: rawConv = 9, base_period: rawBase = 26, leading_span_b_period: rawSpan = 52, displacement: rawDisp = 26 } = req.body;
    const candles = parseArray<any>(rawCandles, 'candle_data');
    const conv = Number(rawConv), base = Number(rawBase), span = Number(rawSpan), disp = Number(rawDisp);
    if ([conv, base, span, disp].some(v => !Number.isFinite(v) || v <= 0)) throw createError('All periods must be positive numbers', 400);

    const high = candles.map(c => Number(c.h ?? c.high));
    const low = candles.map(c => Number(c.l ?? c.low));

    const ichResult = IchimokuCloud.calculate({ high, low, conversionPeriod: conv, basePeriod: base, spanPeriod: span, displacement: disp });
    res.json({ indicator: 'IchimokuCloud', periods: { conversion: conv, base, span_b: span, displacement: disp }, values: ichResult, latest: ichResult.pop() ?? null });
  } catch (error) {
    next(error);
  }
});

// OBV (On-Balance Volume) endpoint
router.post('/obv', async (req, res, next) => {
  try {
    const { candle_data: rawCandles } = req.body;
    const candles = parseArray<any>(rawCandles, 'candle_data');
    const obvValues: { timestamp: string; obv: number }[] = [];
    let obv = 0;

    candles.forEach((c, i) => {
      const close = Number(c.c ?? c.close), volume = Number(c.v ?? c.volume);
      if (!Number.isFinite(close) || !Number.isFinite(volume)) throw createError('Each candle must have numeric close and volume', 400);

      if (i === 0) obv = volume;
      else {
        const prevClose = Number(candles[i-1].c ?? candles[i-1].close);
        obv += close > prevClose ? volume : close < prevClose ? -volume : 0;
      }
      obvValues.push({ timestamp: c.t ?? c.timestamp, obv });
    });

    res.json({ indicator: 'OBV', values: obvValues, count: obvValues.length });
  } catch (error) {
    next(error);
  }
});
// VWAP (Volume-Weighted Average Price) endpoint
router.post('/vwap', async (req, res, next) => {
  try {
    const { candle_data: rawCandles, session_type = 'daily', custom_start_time } = req.body;
    const candles = parseArray<any>(rawCandles, 'candle_data');
    const vwapValues: { timestamp: string; vwap: number; sessionStart: number }[] = [];
    let cumTPV = 0, cumVol = 0, sessionStartIdx = 0;

    candles.forEach((c, i) => {
      const high = Number(c.h ?? c.high), low = Number(c.l ?? c.low), close = Number(c.c ?? c.close), volume = Number(c.v ?? c.volume);
      if (![high, low, close, volume].every(Number.isFinite)) throw createError('Each candle must have numeric high, low, close, and volume', 400);

      const tp = (high + low + close) / 3;
      let reset = false;
      const curr = new Date(c.t ?? c.timestamp);
      if (i > 0) {
        const prev = new Date(candles[i-1].t ?? candles[i-1].timestamp);
        if (session_type === 'daily') reset = curr.getDate() !== prev.getDate();
        else if (session_type === 'weekly') reset = Math.floor(curr.getTime()/(7*24*60*60*1000)) !== Math.floor(prev.getTime()/(7*24*60*60*1000));
        else if (session_type === 'custom' && custom_start_time) reset = curr < new Date(custom_start_time);
      }
      if (reset || i === 0) { cumTPV = 0; cumVol = 0; sessionStartIdx = i; }

      cumTPV += tp * volume;
      cumVol += volume;
      const vwap = cumVol > 0 ? cumTPV / cumVol : tp;
      vwapValues.push({ timestamp: c.t ?? c.timestamp, vwap, sessionStart: sessionStartIdx });
    });

    res.json({ indicator: 'VWAP', sessionType: session_type, values: vwapValues, count: vwapValues.length });
  } catch (error) {
    next(error);
  }
});

export default router;
