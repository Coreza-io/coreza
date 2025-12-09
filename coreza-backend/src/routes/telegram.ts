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
import CredentialManager from "../utils/credentialManager";
import { createLogger } from "../utils/logger";
import axios from "axios";
import { requireAuth } from "../middleware/jwtAuth";

const router = express.Router();
const logger = createLogger("telegram-routes");

// Apply JWT authentication to all routes
router.use(requireAuth);

/**
 * Store Telegram bot credentials
 */
router.post("/credentials", async (req, res) => {
  try {
    // Use authenticated user ID from JWT, not from request body
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
      });
    }

    const { credential_name, bot_token } = req.body;

    if (!credential_name || !bot_token) {
      return res.status(400).json({
        success: false,
        error: "credential_name and bot_token are required",
      });
    }

    // Validate bot token by calling Telegram's getMe API
    try {
      const cleanToken = bot_token.trim();
      const validateUrl = `https://api.telegram.org/bot${cleanToken}/getMe`;
      const validateResponse = await axios.get(validateUrl);

      if (!validateResponse.data.ok) {
        return res.status(400).json({
          success: false,
          error: "Invalid bot token",
        });
      }

      logger.info(
        { botUsername: validateResponse.data.result.username },
        "Telegram bot validated"
      );
    } catch (error: any) {
      logger.error({ err: error }, "Failed to validate Telegram bot token");
      return res.status(400).json({
        success: false,
        error: "Invalid bot token or unable to connect to Telegram API",
      });
    }

    // Store credentials
    const credentialId = await CredentialManager.storeCredentials(
      user_id,
      "telegram",
      credential_name,
      { bot_token }
    );

    logger.info(
      { userId: user_id, credentialId },
      "Telegram credentials stored"
    );

    res.json({
      success: true,
      credential_id: credentialId,
      message: "Telegram bot credentials saved successfully",
    });
  } catch (error) {
    logger.error({ err: error }, "Error storing Telegram credentials");
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
