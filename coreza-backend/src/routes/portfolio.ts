/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { Request, Response, Router } from "express";
import { requireAuth } from "../middleware/jwtAuth";
import { getNodeExecutor } from "../nodes/registry";

const router = Router();

router.use(requireAuth);

router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { mode, workflow_id } = req.body;

    const executor = getNodeExecutor("Portfolio");
    if (!executor) {
      return res
        .status(500)
        .json({ error: "Portfolio executor is not registered" });
    }

    const result = await executor.execute(
      {
        id: req.body.node_id,
        name: req.body.nodeName,
        node_type: req.body.node_type,
        values: { ...req.body, mode },
      } as any,
      {},
      { userId, workflow_id },
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
