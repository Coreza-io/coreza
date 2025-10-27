import express from 'express';
import { IndicatorService } from '../services/indicators';

const router = express.Router();

// RSI endpoint
router.post('/rsi', async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateRSI(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// EMA endpoint
router.post('/ema', async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateEMA(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// SMA endpoint
router.post('/sma', async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateSMA(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// MACD endpoint
router.post('/macd', async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateMACD(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Bollinger Bands endpoint
router.post('/bollinger', async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateBollinger(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ADX endpoint
router.post('/adx', async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateADX(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Stochastic Oscillator endpoint
router.post('/stochastic', async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateStochastic(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Ichimoku Cloud endpoint
router.post('/ichimoku', async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateIchimoku(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// OBV endpoint
router.post('/obv', async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateOBV(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// VWAP endpoint
router.post('/vwap', async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateVWAP(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
