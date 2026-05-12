/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import express from "express";
import { requireAuth } from "../middleware/jwtAuth";
import { InitializeIndicatorsExecutor } from "../nodes/executors/InitializeIndicatorsExecutor";
import { WorkflowNode } from "../nodes/types";
import { buildIndicatorKey, IndicatorStateManager } from "../engine";
import { IndicatorResult, IndicatorService } from "../nodes/logic/indicators";

const router = express.Router();
const initializeIndicatorsExecutor = new InitializeIndicatorsExecutor();
const indicatorStateManager = new IndicatorStateManager();

const parseCandles = (rawCandleData: any): any[] => {
  if (Array.isArray(rawCandleData)) {
    return rawCandleData;
  }

  if (typeof rawCandleData === "string") {
    try {
      const parsed = JSON.parse(rawCandleData);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
};

async function executeIndicatorWithState(
  indicatorType: string,
  req: express.Request,
  batchCalculate: (input: any) => Promise<IndicatorResult>,
): Promise<IndicatorResult> {
  const userId = req.user?.id;
  const workflowId = req.body.workflowId;
  const executionId =
    req.body.executionId || req.body.workflowSessionId || workflowId;
  const symbol = req.body.symbol;
  const timeframe = req.body.timeframe;
  const node_id = req.body.node_id;

  if (userId && workflowId && executionId && symbol && timeframe) {
    const key = buildIndicatorKey(
      userId,
      workflowId,
      executionId,
      symbol,
      timeframe,
      node_id,
    );

    const state = await indicatorStateManager.getState(key);
    if (state && state.warmupCompleted) {
      const candles = parseCandles(req.body.candle_data);

      if (candles.length > 0) {
        const latestBar = candles[candles.length - 1];
        const latestBarTime = String(latestBar?.time ?? "");

        if (latestBarTime && latestBarTime !== state.lastBarTime) {
          const updated = await indicatorStateManager.update(key, latestBar);
          return {
            success: true,
            status: "success",
            data: [
              {
                currentValue: updated.currentValue,
                previousValue: updated.previousValue,
              },
            ],
          };
        }

        return {
          success: true,
          status: "success",
          data: [
            {
              currentValue: state.currentValue,
              previousValue: state.previousValue,
            },
          ],
        };
      }
    }
  }

  return batchCalculate(req.body);
}

// Apply JWT authentication to all routes
router.use(requireAuth);

// Initialize indicators endpoint
router.post("/initialize", async (req, res, next) => {
  try {
    const node: WorkflowNode = {
      id: req.body.node_id,
      name: req.body.nodeName,
      node_type: req.body.node_type,
      category: req.body.category,
      values: req.body,
      data: { values: req.body },
    };

    const userId = req.user?.id;
    const workflowId = req.body.workflowId;
    const executionId =
      req.body.executionId || req.body.workflowSessionId || workflowId;

    const result = await initializeIndicatorsExecutor.execute(node, req.body, {
      userId,
      workflowId,
      executionId,
      indicatorStateManager,
      nodes: req.body.nodes || [],
      edges: req.body.edges || [],
      resolveNodeParameters: (n: WorkflowNode, input: any) => ({
        ...n.values,
        ...input,
      }),
    });

    if (result.success) {
      return res.json(result);
    }

    return res.status(400).json(result);
  } catch (error) {
    return next(error);
  }
});

// RSI endpoint
router.post("/rsi", async (req, res, next) => {
  try {
    const result = await executeIndicatorWithState("rsi", req, (input) =>
      IndicatorService.calculateRSI(input),
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// EMA endpoint
router.post("/ema", async (req, res, next) => {
  try {
    const result = await executeIndicatorWithState("ema", req, (input) =>
      IndicatorService.calculateEMA(input),
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// SMA endpoint
router.post("/sma", async (req, res, next) => {
  try {
    const result = await executeIndicatorWithState("sma", req, (input) =>
      IndicatorService.calculateSMA(input),
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// MACD endpoint
router.post("/macd", async (req, res, next) => {
  try {
    const result = await executeIndicatorWithState("macd", req, (input) =>
      IndicatorService.calculateMACD(input),
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Bollinger Bands endpoint
router.post("/bollinger", async (req, res, next) => {
  try {
    const result = await executeIndicatorWithState("bollinger", req, (input) =>
      IndicatorService.calculateBollinger(input),
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ADX endpoint
router.post("/adx", async (req, res, next) => {
  try {
    const result = await executeIndicatorWithState("adx", req, (input) =>
      IndicatorService.calculateADX(input),
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Stochastic Oscillator endpoint
router.post("/stochastic", async (req, res, next) => {
  try {
    const result = await executeIndicatorWithState("stochastic", req, (input) =>
      IndicatorService.calculateStochastic(input),
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Ichimoku Cloud endpoint
router.post("/ichimoku", async (req, res, next) => {
  try {
    const result = await executeIndicatorWithState("ichimoku", req, (input) =>
      IndicatorService.calculateIchimoku(input),
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// OBV endpoint
router.post("/obv", async (req, res, next) => {
  try {
    const result = await executeIndicatorWithState("obv", req, (input) =>
      IndicatorService.calculateOBV(input),
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// VWAP endpoint
router.post("/vwap", async (req, res, next) => {
  try {
    const result = await executeIndicatorWithState("vwap", req, (input) =>
      IndicatorService.calculateVWAP(input),
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Volume Oscillator endpoint
router.post("/volume-oscillator", async (req, res, next) => {
  try {
    const result = await executeIndicatorWithState(
      "volumeoscillator",
      req,
      (input) => IndicatorService.calculateVolumeOscillator(input),
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Support & Resistance endpoint
router.post("/support-resistance", async (req, res, next) => {
  try {
    const result = await IndicatorService.calculate(
      "support-resistance",
      req.body,
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
