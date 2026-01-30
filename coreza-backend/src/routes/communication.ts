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
import {
  getCommunicationService,
  getCommunicationServiceConfig,
} from "../services/communication";
import CredentialManager from "../utils/credentialManager";
import { requireAuth } from "../middleware/jwtAuth";
import { createLogger } from "../utils/logger";

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
router.post(
  "/:service/:operation",
  async (req: Request, res: Response, next: NextFunction) => {
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

      const commService = getCommunicationService(service);
      if (!commService) {
        return res.status(400).json({ error: `Unknown service: ${service}` });
      }

      const result = await commService.execute({
        operation,
        user_id: userId,
        credential_id,
        ...params,
      });

      if (!result.success) {
        const statusCode = result.error?.includes("authentication") ? 401 : 400;
        return res.status(statusCode).json({ error: result.error });
      }

      res.json({ success: true, ...result.data });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Get credentials for a communication service
 * GET /communication/:service/credentials
 */
router.get(
  "/:service/credentials",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { service } = req.params;

      const credentials = await CredentialManager.listCredentials(
        userId,
        service
      );
      res.json({ success: true, credentials });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Save credentials for a communication service
 * POST /communication/:service/auth
 *
 * Each service has different required fields:
 * - telegram: credential_name, bot_token
 * - whatsapp: credential_name, access_token, phone_number_id
 * - gmail: uses OAuth flow via /oauth/gmail routes
 */
router.post(
  "/:service/auth",
  async (req: Request, res: Response, next: NextFunction) => {
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

      // Get service config from registry
      const config = getCommunicationServiceConfig(service);
      if (!config) {
        return res.status(400).json({ error: `Unknown service: ${service}` });
      }

      // Gmail uses OAuth flow
      if (config.authType === "oauth") {
        return res.status(400).json({
          error: `${service} uses OAuth flow. Use /oauth/${service}/generate-auth-url instead.`,
        });
      }

      // Get service instance for validation
      const commService = getCommunicationService(service);
      if (!commService) {
        return res.status(400).json({ error: `Unknown service: ${service}` });
      }

      // Extract credential fields from request body
      const credentialData: Record<string, any> = {};
      for (const field of config.credentialFields) {
        if (req.body[field] !== undefined) {
          credentialData[field] = req.body[field];
        }
      }

      // Validate credentials using service config
      const validation = await commService.validateCredentials(credentialData);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: validation.error || "Invalid credentials",
        });
      }

      logger.info({ service }, `${service} credentials validated`);

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
  }
);

export default router;
