/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/jwtAuth";
import { BacktestExecutor } from "../nodes/executors/BacktestExecutor";
import { supabase } from "../config/supabase";
import { SimBroker } from "../services/simBroker";

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
      workflow_id,
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
      allow_short,
    } = req.body;

    if (!workflow_id) {
      return res.status(400).json({ error: "workflow_id is required" });
    }

    const result = await backtestExecutor.execute(
      {
        id: "api-init",
        name: "BacktestInit",
        node_type: "BacktestInit",
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
          allow_short,
        },
      } as any,
      {},
      { userId, workflowId: workflow_id }
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

// POST /backtest/trade - Execute a simulated trade
router.post("/trade", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
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
        id: "api-trade",
        name: "BacktestTrade",
        node_type: "BacktestTrade",
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
      { userId }
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

// POST /backtest/snapshot - Record equity snapshot
router.post("/snapshot", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { backtest_id, timestamp, symbol, current_bar, prices } = req.body;

    if (!backtest_id) {
      return res.status(400).json({ error: "backtest_id is required" });
    }

    const result = await backtestExecutor.execute(
      {
        id: "api-snapshot",
        name: "BacktestSnapshot",
        node_type: "BacktestSnapshot",
        values: {
          backtest_id,
          timestamp,
          symbol,
          current_bar,
          prices,
        },
      } as any,
      {},
      { userId }
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.json({ success: true, data: result.data, meta: result.meta });
  } catch (error) {
    console.error("[BacktestRoutes] /snapshot error:", error);
    return res.status(500).json({ error: "Failed to record snapshot" });
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
      { userId }
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

    const { backtest_id, prices } = req.body;

    if (!backtest_id) {
      return res.status(400).json({ error: "backtest_id is required" });
    }

    const result = await backtestExecutor.execute(
      {
        id: "api-portfolio",
        name: "BacktestPortfolio",
        node_type: "BacktestPortfolio",
        values: { backtest_id, prices },
      } as any,
      {},
      { userId }
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
