/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/jwtAuth";
import { getNodeExecutor } from "../nodes/registry";

const router = Router();
const portfolioRequestSchema = z.object({
  mode: z.enum(["backtest", "broker"]),
  workflowId: z.string().uuid(),
  node_id: z.string(),
  nodeName: z.string().optional(),
  node_type: z.string().optional(),
  operation: z.string().optional(),
  symbol: z.string().optional(),
  cash_balance: z.union([z.string(), z.number()]).optional(),
  base_currency: z.string().optional(),
  quantity: z.union([z.string(), z.number()]).optional(),
  side: z.string().optional(),
  price: z.union([z.string(), z.number()]).optional(),
  order_type: z.string().optional(),
  broker: z.string().optional(),
  account_id: z.string().optional(),
  fill_id: z.string().optional(),
  client_order_id: z.string().optional(),
  commission: z.union([z.string(), z.number()]).optional(),
  status: z.string().optional(),
  current_bar: z.any().optional(),
  prices: z.any().optional(),
  backtest_id: z.string().optional(),

  // v2 fields
  broker_order_id: z.string().optional(),
  execution_id: z.string().optional(),
  orig_qty: z.union([z.string(), z.number()]).optional(),
  cum_filled_qty: z.union([z.string(), z.number()]).optional(),
  exec_qty: z.union([z.string(), z.number()]).optional(),
  exec_price: z.union([z.string(), z.number()]).optional(),
  position_qty: z.union([z.string(), z.number()]).optional(),
  remaining_qty: z.union([z.string(), z.number()]).optional(),
  avg_fill_price: z.union([z.string(), z.number()]).optional(),
  market_price: z.union([z.string(), z.number()]).optional(),
  quote_notional: z.union([z.string(), z.number()]).optional(),
  fee_amount: z.union([z.string(), z.number()]).optional(),
  fee_asset: z.string().optional(),
  asset: z.string().optional(),
  total: z.union([z.string(), z.number()]).optional(),
  available: z.union([z.string(), z.number()]).optional(),
  locked: z.union([z.string(), z.number()]).optional(),
  avg_entry_price: z.union([z.string(), z.number()]).optional(),
  realized_pnl: z.union([z.string(), z.number()]).optional(),
  time_in_force: z.string().optional(),
  limit_price: z.union([z.string(), z.number()]).optional(),
  stop_price: z.union([z.string(), z.number()]).optional(),
  trail_percent: z.union([z.string(), z.number()]).optional(),
  trail_price: z.union([z.string(), z.number()]).optional(),

  // Legacy aliases
  orderType: z.string().optional(),
  limitPrice: z.union([z.string(), z.number()]).optional(),
  stopPrice: z.union([z.string(), z.number()]).optional(),
  tif: z.string().optional(),
  timeInForce: z.string().optional(),
  trailPercent: z.union([z.string(), z.number()]).optional(),
  trailPrice: z.union([z.string(), z.number()]).optional(),
});

router.use(requireAuth);

router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = portfolioRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const body = parsed.data;

    const executor = getNodeExecutor("Portfolio");
    if (!executor) {
      return res
        .status(500)
        .json({ error: "Portfolio executor is not registered" });
    }

    const result = await executor.execute(
      {
        id: body.node_id,
        name: body.nodeName ?? "portfolio",
        node_type: body.node_type ?? "Portfolio",
        values: { ...body, mode: body.mode },
      } as any,
      {},
      { userId, workflowId: body.workflowId },
    );

    if (!result.success) {
      return res
        .status(400)
        .json({ error: result.error || "Portfolio execution failed" });
    }

    return res.json(result);
  } catch (error) {
    console.error("[PortfolioRoutes] / error:", error);
    return res.status(500).json({ error: "Failed to execute portfolio node" });
  }
});

export default router;
