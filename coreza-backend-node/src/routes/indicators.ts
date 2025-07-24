import express from 'express';
import { RSI, EMA, SMA, MACD, BollingerBands } from 'trading-signals';
import { ADX, Stochastic, IchimokuKinkoHyo } from 'technicalindicators';
import { createError } from '../middleware/errorHandler';

const router = express.Router();

// RSI endpoint
router.post('/rsi', async (req, res, next) => {
  try {
    const { prices, period = 14 } = req.body;
    
    if (!prices || !Array.isArray(prices)) {
      throw createError('Prices array is required', 400);
    }
    
    const rsi = new RSI(period);
    const results: number[] = [];
    
    for (const price of prices) {
      rsi.update(parseFloat(price));
      if (rsi.isStable) {
        results.push(rsi.getResult());
      }
    }
    
    res.json({
      indicator: 'RSI',
      period,
      values: results,
      latest: results[results.length - 1] || null
    });
  } catch (error) {
    next(error);
  }
});

// EMA endpoint
router.post('/ema', async (req, res, next) => {
  try {
    const { prices, period = 20 } = req.body;
    
    if (!prices || !Array.isArray(prices)) {
      throw createError('Prices array is required', 400);
    }
    
    const ema = new EMA(period);
    const results: number[] = [];
    
    for (const price of prices) {
      ema.update(parseFloat(price));
      if (ema.isStable) {
        results.push(ema.getResult());
      }
    }
    
    res.json({
      indicator: 'EMA',
      period,
      values: results,
      latest: results[results.length - 1] || null
    });
  } catch (error) {
    next(error);
  }
});

// SMA endpoint
router.post('/sma', async (req, res, next) => {
  try {
    const { prices, period = 20 } = req.body;
    
    if (!prices || !Array.isArray(prices)) {
      throw createError('Prices array is required', 400);
    }
    
    const sma = new SMA(period);
    const results: number[] = [];
    
    for (const price of prices) {
      sma.update(parseFloat(price));
      if (sma.isStable) {
        results.push(sma.getResult());
      }
    }
    
    res.json({
      indicator: 'SMA',
      period,
      values: results,
      latest: results[results.length - 1] || null
    });
  } catch (error) {
    next(error);
  }
});

// MACD endpoint
router.post('/macd', async (req, res, next) => {
  try {
    const { prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9 } = req.body;
    
    if (!prices || !Array.isArray(prices)) {
      throw createError('Prices array is required', 400);
    }
    
    const macd = new MACD({
      indicator: EMA,
      short: fastPeriod,
      long: slowPeriod,
      signal: signalPeriod
    });
    
    const results: any[] = [];
    
    for (const price of prices) {
      macd.update(parseFloat(price));
      if (macd.isStable) {
        const result = macd.getResult();
        results.push({
          macd: result.macd,
          signal: result.signal,
          histogram: result.histogram
        });
      }
    }
    
    res.json({
      indicator: 'MACD',
      periods: { fast: fastPeriod, slow: slowPeriod, signal: signalPeriod },
      values: results,
      latest: results[results.length - 1] || null
    });
  } catch (error) {
    next(error);
  }
});

// Bollinger Bands endpoint
router.post('/bollinger', async (req, res, next) => {
  try {
    const { prices, period = 20, stdDev = 2 } = req.body;
    
    if (!prices || !Array.isArray(prices)) {
      throw createError('Prices array is required', 400);
    }
    
    const bb = new BollingerBands(period, stdDev);
    const results: any[] = [];
    
    for (const price of prices) {
      bb.update(parseFloat(price));
      if (bb.isStable) {
        const result = bb.getResult();
        results.push({
          upper: result.upper,
          middle: result.middle,
          lower: result.lower
        });
      }
    }
    
    res.json({
      indicator: 'BollingerBands',
      period,
      stdDev,
      values: results,
      latest: results[results.length - 1] || null
    });
  } catch (error) {
    next(error);
  }
});

// ADX endpoint
router.post('/adx', async (req, res, next) => {
  try {
    const { candle_data, period = 14 } = req.body;
    
    if (!candle_data || !Array.isArray(candle_data)) {
      throw createError('Candle data array is required', 400);
    }
    
    const high = candle_data.map(candle => parseFloat(candle.high));
    const low = candle_data.map(candle => parseFloat(candle.low));
    const close = candle_data.map(candle => parseFloat(candle.close));
    
    const adxResult = ADX.calculate({
      high,
      low,
      close,
      period: parseInt(period)
    });
    
    res.json({
      indicator: 'ADX',
      period,
      values: adxResult,
      latest: adxResult[adxResult.length - 1] || null
    });
  } catch (error) {
    next(error);
  }
});

// Stochastic Oscillator endpoint
router.post('/stochastic', async (req, res, next) => {
  try {
    const { candle_data, k_period = 14, d_period = 3, smooth = 3 } = req.body;
    
    if (!candle_data || !Array.isArray(candle_data)) {
      throw createError('Candle data array is required', 400);
    }
    
    const high = candle_data.map(candle => parseFloat(candle.high));
    const low = candle_data.map(candle => parseFloat(candle.low));
    const close = candle_data.map(candle => parseFloat(candle.close));
    
    const stochResult = Stochastic.calculate({
      high,
      low,
      close,
      period: parseInt(k_period),
      signalPeriod: parseInt(d_period)
    });
    
    res.json({
      indicator: 'Stochastic',
      periods: { k: k_period, d: d_period, smooth },
      values: stochResult,
      latest: stochResult[stochResult.length - 1] || null
    });
  } catch (error) {
    next(error);
  }
});

// Ichimoku Cloud endpoint
router.post('/ichimoku', async (req, res, next) => {
  try {
    const { 
      candle_data, 
      conversion_period = 9, 
      base_period = 26, 
      leading_span_b_period = 52, 
      displacement = 26 
    } = req.body;
    
    if (!candle_data || !Array.isArray(candle_data)) {
      throw createError('Candle data array is required', 400);
    }
    
    const high = candle_data.map(candle => parseFloat(candle.high));
    const low = candle_data.map(candle => parseFloat(candle.low));
    
    const ichimokuResult = IchimokuKinkoHyo.calculate({
      high,
      low,
      conversionPeriod: parseInt(conversion_period),
      basePeriod: parseInt(base_period),
      spanPeriod: parseInt(leading_span_b_period),
      displacement: parseInt(displacement)
    });
    
    res.json({
      indicator: 'IchimokuCloud',
      periods: {
        conversion: conversion_period,
        base: base_period,
        span_b: leading_span_b_period,
        displacement
      },
      values: ichimokuResult,
      latest: ichimokuResult[ichimokuResult.length - 1] || null
    });
  } catch (error) {
    next(error);
  }
});

export default router;