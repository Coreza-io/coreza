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
import { DataService } from "../services/data";
import { requireAuth } from "../middleware/jwtAuth";

const router = express.Router();

// Apply JWT authentication to all routes
router.use(requireAuth);

// Get user credentials list for FinnHub
router.get("/credentials", async (req, res, next) => {
  try {
    // Use authenticated user ID from JWT, not from query params
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await DataService.execute("finnhub", "list_credentials", {
      userId: user_id,
    });

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      success: true,
      credentials: result.data || [],
    });
  } catch (error) {
    next(error);
  }
});

// Save and validate credentials (authAction)
router.post("/auth", async (req, res, next) => {
  try {
    // Use authenticated user ID from JWT, not from request body
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { credential_name, api_key } = req.body;

    if (!credential_name || !api_key) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const result = await DataService.execute("finnhub", "save_credentials", {
      userId: user_id,
      credentialName: credential_name,
      apiKey: api_key,
    });

    if (!result.success) {
      return res.status(401).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

// Get quote data (main action)
router.post("/get-quote", async (req, res, next) => {
  try {
    // Use authenticated user ID from JWT, not from request body
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { credential_id, ticker } = req.body;

    if (!credential_id || !ticker) {
      return res
        .status(400)
        .json({ error: "credential_id and ticker are required" });
    }

    const result = await DataService.execute("finnhub", "get_quote", {
      userId: user_id,
      credentialId: credential_id,
      ticker,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result.data);
  } catch (error) {
    next(error);
  }
});

export default router;
