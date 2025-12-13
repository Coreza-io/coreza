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

// Apply JWT authentication to all routes
router.use(requireAuth);

// Get user's Polygon credentials
router.get("/credentials", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: "User not authenticated" });
    }

    const result = await DataService.execute("polygon", "list_credentials", {
      user_id: userId,
    });

    return res.json(result);
  } catch (error) {
    console.error("Error fetching Polygon credentials:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch credentials",
    });
  }
});

// Save/validate Polygon credentials
router.post("/auth", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { credential_name, api_key } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: "User not authenticated" });
    }

    if (!credential_name || !api_key) {
      return res.status(400).json({
        success: false,
        error: "credential_name and api_key are required",
      });
    }

    // Validate API key by making a test request
    const validationResult = await DataService.execute("polygon", "validate_credentials", {
      api_key,
    });

    if (!validationResult.success) {
      return res.status(400).json({
        success: false,
        error: validationResult.error || "Invalid Polygon API key",
      });
    }

    // Save credentials using CredentialManager
    await CredentialManager.saveCredential({
      userId,
      name: credential_name,
      serviceType: "polygon",
      clientJson: { api_key },
      tokenJson: null,
    });

    return res.json({
      success: true,
      message: "Polygon credentials saved successfully",
    });
  } catch (error) {
    console.error("Error saving Polygon credentials:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to save credentials",
    });
  }
});

// Execute Polygon operations
router.post("/execute", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { credential_id, operation, ticker, timeframe, limit } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: "User not authenticated" });
    }

    if (!credential_id || !operation) {
      return res.status(400).json({
        success: false,
        error: "credential_id and operation are required",
      });
    }

    const result = await DataService.execute("polygon", operation, {
      user_id: userId,
      credential_id,
      ticker,
      timeframe,
      limit: limit ? parseInt(limit, 10) : 10,
    });

    return res.json(result);
  } catch (error) {
    console.error("Error executing Polygon operation:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to execute operation",
    });
  }
});

export default router;
