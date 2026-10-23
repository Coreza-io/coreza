import { resultFailure, safeErrorDetails } from "../contracts/nodeResult";
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
import { RiskEngineService } from "../nodes/logic/risk";

const router = express.Router();

// Apply JWT auth to all routes
router.use(requireAuth);

router.post("/engine", async (req, res) => {
  try {
    const result = RiskEngineService.evaluate(req.body);
    if (result.status === "error") {
      return res.status(400).json(resultFailure(result.error ?? "Node operation failed", { data: null }));
    }
    res.json(result);
  } catch (error) {
    console.error("Risk engine error:", error);
    res.status(500).json(resultFailure("Failed to evaluate risk engine", { data: null, details: safeErrorDetails({ ...safeErrorDetails((error instanceof Error ? error.message : String(error))) }) }));
  }
});

export default router;
