/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/jwtAuth";
import {
  BacktestExecutor,
  SimBroker,
  BacktestSessionManager,
} from "../backtest";
import { supabase } from "../config/supabase";

const router = Router();
const backtestExecutor = new BacktestExecutor();

// Apply auth to all routes
router.use(requireAuth);

// POST /backtest/init - Initialize a new backtest session
router.post("/init", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      workflowId,
      workflowSessionId,
      node_id,
      nodeName,
      node_type,
      name,
      description,
      initial_capital,
      start_date,
      end_date,
      fill_model,
      slippage_model,
      slippage_value,
      commission_model,
      commission_value,
      broker,
      credential_id,
      symbols,
      interval,
      asset_type,
      feed,
      warmup_period,
      nodes,
      edges,
    } = req.body;

    if (!workflowId) {
      return res.status(400).json({ error: "workflowId is required" });
    }

    const result = await backtestExecutor.execute(
      {
        id: node_id,
        name: nodeName,
        node_type: node_type,
        values: {
          name,
          description,
          initial_capital,
          start_date,
          end_date,
          fill_model,
          slippage_model,
          slippage_value,
          commission_model,
          commission_value,
          broker,
          credential_id,
          symbols,
          interval,
          asset_type,
          feed,
          warmup_period,
        },
      } as any,
      {},
      { userId, workflowSessionId, workflowId, nodes, edges },
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json(result);
  } catch (error) {
    console.error("[BacktestRoutes] /init error:", error);
    return res.status(500).json({ error: "Failed to initialize backtest" });
  }
});

// POST /backtest/onbar - Process one bar from an active backtest session
router.post("/onbar", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { backtest_id } = req.body;
    if (!backtest_id) {
      return res.status(400).json({ error: "backtest_id is required" });
    }

    const session =
      BacktestSessionManager.getInstance().getSession(backtest_id);
    if (!session) {
      return res
        .status(404)
        .json({ error: "No active session. Run BacktestInit first." });
    }

    if (session.status === "finished") {
      return res.json({ success: true, data: { isLast: true } });
    }

    const result = await session.nextBar(true);
    return res.json({ success: true, data: result });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Step already in progress"
    ) {
      return res.status(409).json({ error: "Step already in progress" });
    }

    console.error("[BacktestRoutes] /onbar error:", error);
    return res.status(500).json({ error: "Failed to process backtest bar" });
  }
});

// POST /backtest/run - Run remaining bars asynchronously
router.post("/run", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { backtest_id } = req.body;
    if (!backtest_id) {
      return res.status(400).json({ error: "backtest_id is required" });
    }

    const session =
      BacktestSessionManager.getInstance().getSession(backtest_id);
    if (!session) {
      return res.status(404).json({ error: "No active session" });
    }

    session
      .runAll()
      .catch((err) => console.error("[Backtest] runAll failed:", err))
      .finally(() =>
        BacktestSessionManager.getInstance().deleteSession(backtest_id),
      );

    return res.json({ success: true, status: "running" });
  } catch (error) {
    console.error("[BacktestRoutes] /run error:", error);
    return res.status(500).json({ error: "Failed to run backtest" });
  }
});

// POST /backtest/reset - Reset session to first bar
router.post("/reset", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { backtest_id } = req.body;
    if (!backtest_id) {
      return res.status(400).json({ error: "backtest_id is required" });
    }

    const session =
      BacktestSessionManager.getInstance().getSession(backtest_id);
    if (!session) {
      return res.status(404).json({ error: "No active session" });
    }

    await session.reset();
    return res.json({ success: true, status: "ready" });
  } catch (error) {
    console.error("[BacktestRoutes] /reset error:", error);
    return res.status(500).json({ error: "Failed to reset backtest" });
  }
});

// POST /backtest/trade - Execute a simulated trade
router.post("/trade", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      node_id,
      nodeName,
      node_type,
      backtest_id,
      symbol,
      side,
      quantity,
      order_type,
      limit_price,
      stop_price,
      current_bar,
    } = req.body;

    if (!backtest_id || !symbol || !side || !quantity) {
      return res.status(400).json({
        error: "backtest_id, symbol, side, and quantity are required",
      });
    }

    const result = await backtestExecutor.execute(
      {
        id: node_id,
        name: nodeName,
        node_type,
        values: {
          backtest_id,
          symbol,
          side,
          quantity,
          order_type,
          limit_price,
          stop_price,
          current_bar,
        },
      } as any,
      {},
      { userId },
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ success: true, data: result.data, meta: result.meta });
  } catch (error) {
    console.error("[BacktestRoutes] /trade error:", error);
    return res.status(500).json({ error: "Failed to execute trade" });
  }
});

// POST /backtest/results - Finalize backtest and persist results
router.post("/results", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { backtest_id } = req.body;

    if (!backtest_id) {
      return res.status(400).json({ error: "backtest_id is required" });
    }

    const result = await backtestExecutor.execute(
      {
        id: "api-results",
        name: "BacktestResults",
        node_type: "BacktestResults",
        values: { backtest_id },
      } as any,
      {},
      { userId },
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ success: true, data: result.data, meta: result.meta });
  } catch (error) {
    console.error("[BacktestRoutes] /results error:", error);
    return res.status(500).json({ error: "Failed to finalize backtest" });
  }
});

// POST /backtest/portfolio - Get current portfolio state
router.post("/portfolio", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { backtest_id, operation, symbol, current_bar, prices } = req.body;

    if (!backtest_id) {
      return res.status(400).json({ error: "backtest_id is required" });
    }

    const result = await backtestExecutor.execute(
      {
        id: "api-portfolio",
        name: "BacktestPortfolio",
        node_type: "BacktestPortfolio",
        values: { backtest_id, operation, symbol, current_bar, prices },
      } as any,
      {},
      { userId },
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ success: true, data: result.data, meta: result.meta });
  } catch (error) {
    console.error("[BacktestRoutes] /portfolio error:", error);
    return res.status(500).json({ error: "Failed to get portfolio state" });
  }
});

// GET /backtest/:id - Get backtest details
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;

    const { data: backtest, error } = await supabase
      .from("backtests")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (error || !backtest) {
      return res.status(404).json({ error: "Backtest not found" });
    }

    return res.json(backtest);
  } catch (error) {
    console.error("[BacktestRoutes] GET /:id error:", error);
    return res.status(500).json({ error: "Failed to get backtest" });
  }
});

// DELETE /backtest/:id - Cleanup backtest data
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;

    // Verify ownership
    const { data: backtest, error: fetchError } = await supabase
      .from("backtests")
      .select("id")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (fetchError || !backtest) {
      return res.status(404).json({ error: "Backtest not found" });
    }

    // Cleanup Redis state
    const simBroker = new SimBroker(id);
    await simBroker.cleanup();

    // Delete from Supabase (cascades to related tables via foreign keys)
    const { error: deleteError } = await supabase
      .from("backtests")
      .delete()
      .eq("id", id);

    if (deleteError) {
      return res.status(500).json({ error: "Failed to delete backtest" });
    }

    return res.json({ success: true, message: "Backtest deleted" });
  } catch (error) {
    console.error("[BacktestRoutes] DELETE /:id error:", error);
    return res.status(500).json({ error: "Failed to delete backtest" });
  }
});

export default router;
