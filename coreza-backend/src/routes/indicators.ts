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

import express from 'express';
import { requireTrader } from '../middleware/licenseCheck';
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
router.post('/adx', requireTrader('Advanced Indicators'), async (req, res, next) => {
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
router.post('/ichimoku', requireTrader('Advanced Indicators'), async (req, res, next) => {
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
router.post('/vwap', requireTrader('Advanced Indicators'), async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateVWAP(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Volume Oscillator endpoint
router.post('/volume-oscillator', async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateVolumeOscillator(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Support & Resistance endpoint
router.post('/support-resistance', async (req, res, next) => {
  try {
    const result = await IndicatorService.calculate('support-resistance', req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
