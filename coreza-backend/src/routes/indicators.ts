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

import express from "express";
import { requireAuth } from "../middleware/jwtAuth";
import { InitializeIndicatorsExecutor } from "../nodes/executors/InitializeIndicatorsExecutor";
import { WorkflowNode } from "../nodes/types";
import { IndicatorStateManager } from "../services/indicatorStateManager";
import { IndicatorService } from "../services/indicators";

const router = express.Router();
const initializeIndicatorsExecutor = new InitializeIndicatorsExecutor();
const indicatorStateManager = new IndicatorStateManager();

// Apply JWT authentication to all routes
router.use(requireAuth);

// Initialize indicators endpoint
router.post("/initialize", async (req, res, next) => {
  try {
    const node: WorkflowNode = {
      id: req.body.nodeId || "manual-init",
      name: "InitializeIndicators",
      node_type: "main",
      category: "Indicators",
      values: req.body,
      data: { values: req.body },
    };

    const userId = req.user?.id || req.body.user_id;
    const workflowId = req.body.workflow_id || "manual";
    const runId = req.body.run_id || `manual-${Date.now()}`;

    const result = await initializeIndicatorsExecutor.execute(node, req.body, {
      userId,
      workflowId,
      runId,
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
    const result = await IndicatorService.calculateRSI(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// EMA endpoint
router.post("/ema", async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateEMA(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// SMA endpoint
router.post("/sma", async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateSMA(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// MACD endpoint
router.post("/macd", async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateMACD(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Bollinger Bands endpoint
router.post("/bollinger", async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateBollinger(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ADX endpoint
router.post("/adx", async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateADX(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Stochastic Oscillator endpoint
router.post("/stochastic", async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateStochastic(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Ichimoku Cloud endpoint
router.post("/ichimoku", async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateIchimoku(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// OBV endpoint
router.post("/obv", async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateOBV(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// VWAP endpoint
router.post("/vwap", async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateVWAP(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Volume Oscillator endpoint
router.post("/volume-oscillator", async (req, res, next) => {
  try {
    const result = await IndicatorService.calculateVolumeOscillator(req.body);
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
