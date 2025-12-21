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

/**
 * Enhanced credentials API routes with envelope encryption support
 * Provides migration capabilities and dual-read functionality
 */

import express from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/jwtAuth";
import CredentialManager from "../utils/credentialManager";
import CredentialCache from "../utils/credentialCache";

const router = express.Router();

// Apply JWT auth to all routes except health check
router.use((req, res, next) => {
  // Skip auth for health check
  if (req.path === "/health") {
    return next();
  }
  return requireAuth(req, res, next);
});

// List credentials metadata
router.get("/list", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const serviceType = req.query.service_type as string;

    const credentials = await CredentialManager.listCredentials(
      userId,
      serviceType
    );

    res.json({
      credentials,
      count: credentials.length,
    });
  } catch (error) {
    console.error("List credentials error:", error);
    res.status(500).json({
      error: "Failed to list credentials",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Delete credential
router.delete("/", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { credential_id } = req.body;

    await CredentialManager.deleteCredential(userId, credential_id);
    await CredentialCache.getInstance().invalidate(userId);

    res.json({
      success: true,
      message: "Credential deleted successfully",
    });
  } catch (error) {
    console.error("Delete credential error:", error);
    res.status(500).json({
      error: "Failed to delete credential",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
