import { serviceNodeResult } from "../nodes/serviceNodeResult";
import { resultFailure } from "../contracts/nodeResult";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../middleware/jwtAuth";
import {
  getDataSourceService,
  DataSourceService,
} from "../services/datasources";
import CredentialManager from "../utils/credentialManager";

const router = Router();

// Apply JWT authentication to all routes
router.use(requireAuth);

// Generic data source operation - handles ALL data services
// POST /datasource/:service/:operation
router.post("/:service/:operation", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json(resultFailure("Unauthorized", { data: null }));
    }

    const { service } = req.params;
    const { credential_id, operation, ...params } = req.body;

    console.log(`📊 [DATASOURCE-ROUTE] ${service}/${operation} request:`, {
      userId,
      credential_id,
      params,
    });

    const dataSourceService = getDataSourceService(service);
    if (!dataSourceService) {
      return res.status(400).json(resultFailure(`Unsupported data source: ${service}`, { data: null }));
    }

    const result = await dataSourceService.execute({
      user_id: userId,
      credential_id,
      operation,
      ...params,
    });

    console.log(
      `📊 [DATASOURCE-ROUTE] ${service}/${operation} result:`,
      result.success
    );
    res.json(serviceNodeResult(result));
  } catch (error: any) {
    console.error("[DATASOURCE-ROUTE] Error:", error);
    res.status(500).json(resultFailure(error.message || "Unknown error", { data: null }));
  }
});

// Save/validate credentials for any data service
// POST /datasource/:service/auth
router.post("/:service/auth", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { service } = req.params;
    const { credential_name, api_key } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    if (!credential_name || !api_key) {
      return res.status(400).json({
        success: false,
        error: "credential_name and api_key are required",
      });
    }

    // Validate credentials using service's validateCredentials method
    const dataSourceService = getDataSourceService(service) as
      | DataSourceService
      | undefined;
    if (
      dataSourceService &&
      typeof dataSourceService.validateCredentials === "function"
    ) {
      const validation = await dataSourceService.validateCredentials(api_key);

      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: validation.error || "Invalid credentials",
        });
      }
    }

    // Save credentials
    await CredentialManager.saveCredentials(userId, service, credential_name, {
      api_key,
    });

    res.json({
      success: true,
      message: `${service} credentials saved successfully`,
    });
  } catch (error: any) {
    console.error("[DATASOURCE-ROUTE] Auth error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
