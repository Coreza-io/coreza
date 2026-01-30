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

import express, { Request, Response, NextFunction } from "express";
import { CommunicationService } from "../services/communications";
import CredentialManager from "../utils/credentialManager";
import { requireAuth } from "../middleware/jwtAuth";
import { createLogger } from "../utils/logger";
import axios from "axios";

const router = express.Router();
const logger = createLogger("communication-routes");

// Apply JWT authentication to all routes
router.use(requireAuth);

/**
 * Generic communication operation
 * POST /communication/:service/:operation
 * 
 * Supported services: gmail, whatsapp, telegram
 * 
 * Examples:
 *   POST /communication/gmail/send
 *   POST /communication/whatsapp/send_message
 *   POST /communication/telegram/send_message
 */
router.post("/:service/:operation", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { service, operation } = req.params;
    const { credential_id, ...params } = req.body;

    logger.debug(
      { userId, service, operation },
      "Processing communication request"
    );

    const result = await CommunicationService.execute(service, operation, {
      user_id: userId,
      credential_id,
      ...params,
    });

    if (!result.success) {
      const statusCode = result.error?.includes("authentication") ? 401 : 400;
      return res.status(statusCode).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * Get credentials for a communication service
 * GET /communication/:service/credentials
 */
router.get("/:service/credentials", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { service } = req.params;
    
    const credentials = await CredentialManager.listCredentials(userId, service);
    res.json({ success: true, credentials });
  } catch (error) {
    next(error);
  }
});

/**
 * Save credentials for a communication service
 * POST /communication/:service/auth
 * 
 * Each service has different required fields:
 * - telegram: credential_name, bot_token
 * - whatsapp: credential_name, access_token, phone_number_id
 * - gmail: uses OAuth flow via /oauth/gmail routes
 */
router.post("/:service/auth", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { service } = req.params;
    const { credential_name } = req.body;

    if (!credential_name) {
      return res.status(400).json({ error: "credential_name is required" });
    }

    let credentialData: Record<string, any> = {};

    switch (service.toLowerCase()) {
      case "telegram": {
        const { bot_token } = req.body;
        if (!bot_token) {
          return res.status(400).json({ error: "bot_token is required" });
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

        credentialData = { bot_token };
        break;
      }

      case "whatsapp": {
        const { access_token, phone_number_id } = req.body;
        if (!access_token || !phone_number_id) {
          return res.status(400).json({
            error: "access_token and phone_number_id are required",
          });
        }
        credentialData = { access_token, phone_number_id };
        break;
      }

      case "gmail":
        return res.status(400).json({
          error: "Gmail uses OAuth flow. Use /oauth/gmail/generate-auth-url instead.",
        });

      default:
        return res.status(400).json({
          error: `Unsupported service: ${service}`,
        });
    }

    // Store credentials
    const credentialId = await CredentialManager.storeCredentials(
      userId,
      service,
      credential_name,
      credentialData
    );

    logger.info(
      { userId, service, credentialId },
      "Communication credentials stored"
    );

    res.json({
      success: true,
      credential_id: credentialId,
      message: `${service} credentials saved successfully`,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
