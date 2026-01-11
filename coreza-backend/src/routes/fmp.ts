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

import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/jwtAuth";
import { DataService } from "../services/data";
import CredentialManager from "../utils/credentialManager";

const router = Router();

// All FMP routes require authentication
router.use(requireAuth);

/**
 * GET /fmp/credentials
 * Returns list of saved FMP credentials for the authenticated user
 */
router.get("/credentials", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    const result = await DataService.execute("fmp", "list_credentials", { user_id: userId });
    return res.json(result);
  } catch (error: any) {
    console.error("Error fetching FMP credentials:", error);
    return res.status(500).json({ success: false, error: error.message || "Failed to fetch credentials" });
  }
});

/**
 * POST /fmp/auth
 * Save/validate FMP API credentials
 */
router.post("/auth", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { credential_name, api_key } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    if (!credential_name || !api_key) {
      return res.status(400).json({ success: false, error: "credential_name and api_key are required" });
    }

    // Validate the API key by making a test request
    const validation = await DataService.execute("fmp", "validate_credentials", { api_key });
    if (!validation.success) {
      return res.status(400).json({ success: false, error: validation.error || "Invalid FMP API key" });
    }

    // Save credentials
    await CredentialManager.saveCredentials(userId, "fmp", credential_name, { api_key });

    return res.json({ success: true, message: "FMP credentials saved successfully" });
  } catch (error: any) {
    console.error("Error saving FMP credentials:", error);
    return res.status(500).json({ success: false, error: error.message || "Failed to save credentials" });
  }
});

/**
 * POST /fmp/execute
 * Execute FMP operations
 */
router.post("/execute", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { 
      credential_id, 
      operation, 
      symbol, 
      tickers,
      query,
      period, 
      limit,
      page,
      from,
      to,
    } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }

    if (!credential_id || !operation) {
      return res.status(400).json({ success: false, error: "credential_id and operation are required" });
    }

    const parsedLimit =
      limit !== undefined && limit !== "" ? parseInt(limit, 10) : undefined;
    const parsedPage =
      page !== undefined && page !== "" ? parseInt(page, 10) : undefined;

    const result = await DataService.execute("fmp", operation, {
      user_id: userId,
      credential_id,
      symbol,
      tickers,
      query,
      period,
      limit: parsedLimit,
      page: parsedPage,
      from,
      to,
    });

    return res.json(result);
  } catch (error: any) {
    console.error("Error executing FMP operation:", error);
    return res.status(500).json({ success: false, error: error.message || "Failed to execute operation" });
  }
});

export default router;
