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
import { getStorageService } from "../services/storage";
import CredentialManager from "../utils/credentialManager";
import { testRedisConnection } from "../services/storage/helpers/redisConnection";
import { CredentialValidator } from "../utils/credentialValidator";
import { supabase } from "../config/supabase";
import { createClient } from "@supabase/supabase-js";
import { getRedisCache } from "../config/redis";
import { buildStoreKey, extractVariableNameFromKey } from "../utils/store";
import logger from "../utils/logger";
import { buildExecutionScopedKey } from "../utils/executionKey";
import { RollingWindow } from "../engine/RollingWindow";
import { DataContextManager } from "../engine/DataContext";
import {
  buildRollingWindowPayload,
  clampWindowSize,
  normalizeSymbol,
  normalizeTimeframe,
  parseCandleData,
  ROLLING_WINDOW_ERRORS,
  buildRollingWindowNotFoundPayload,
} from "../engine/rollingWindowHelpers";

const router = Router();

// Apply JWT auth to all routes
router.use(requireAuth);

// POST /storage/rolling-window
router.post("/rolling-window", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const {
      size,
      candle_data,
      symbol,
      timeframe,
      workflowId,
      executionId: requestedExecutionId,
      workflowSessionId,
      operation = "set",
    } = req.body;
    const executionId = requestedExecutionId ?? workflowSessionId;
    if (!executionId) {
      return res.status(400).json({
        success: false,
        error: "executionId or workflowSessionId is required",
      });
    }

    const normalizedSymbol = normalizeSymbol(symbol);
    const normalizedTimeframe = normalizeTimeframe(timeframe);

    if (operation === "get") {
      if (!normalizedSymbol) {
        return res.status(400).json({
          success: false,
          error: ROLLING_WINDOW_ERRORS.symbolRequired,
        });
      }

      if (!normalizedTimeframe) {
        return res.status(400).json({
          success: false,
          error: ROLLING_WINDOW_ERRORS.timeframeRequired,
        });
      }

      const storeKey = buildExecutionScopedKey({
        userId,
        workflowId,
        executionId,
        scope: "rolling_window",
        parts: [normalizedSymbol, normalizedTimeframe],
      });
      const dataContext =
        DataContextManager.getInstance().getExistingContext(executionId);
      if (!dataContext) {
        return res.status(404).json({
          success: false,
          error: "Execution context not found or already completed",
        });
      }
      const window = dataContext.getDataByKey(storeKey) as
        | RollingWindow<unknown>
        | undefined;

      if (!window) {
        return res.status(404).json({
          success: false,
          data: buildRollingWindowNotFoundPayload(
            normalizedSymbol,
            normalizedTimeframe,
          ),
          meta: {
            key: storeKey,
            timeframe: normalizedTimeframe,
            timestamp: new Date().toISOString(),
          },
        });
      }

      return res.json({
        success: true,
        status: "success",
        data: buildRollingWindowPayload(window),
        meta: {
          key: storeKey,
          timeframe: normalizedTimeframe,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const windowSize = clampWindowSize(size);
    const storeKey = buildExecutionScopedKey({
      userId,
      workflowId,
      executionId,
      scope: "rolling_window",
      parts: [normalizedSymbol || "_", normalizedTimeframe || "_"],
    });
    const parsed = parseCandleData(candle_data);
    if (!parsed.ok) {
      return res.status(400).json({ success: false, error: parsed.error });
    }

    const dataContext = DataContextManager.getInstance().getContext({
      executionId,
      workflowId,
      userId,
    });
    let window = dataContext.getDataByKey(storeKey) as
      | RollingWindow<unknown>
      | undefined;
    if (!window || window.size !== windowSize) {
      window = new RollingWindow<unknown>(windowSize);
    }

    for (const bar of parsed.bars) {
      window.add(bar);
    }
    dataContext.setData(storeKey, window);
    res.json({
      success: true,
      status: "success",
      data: buildRollingWindowPayload(window),
      meta: {
        key: storeKey,
        barsAdded: parsed.bars.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get credentials for a storage service
// GET /storage/:service/credentials
router.get("/:service/credentials", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { service } = req.params;
    const credentials = await CredentialManager.listCredentials(
      userId,
      service,
    );

    res.json({
      success: true,
      credentials: credentials.map((c: any) => ({
        id: c.name,
        name: c.name,
        created_at: c.created_at,
      })),
    });
  } catch (error: any) {
    logger.error({ err: error }, "Error fetching storage credentials");
    res.status(500).json({ error: error.message });
  }
});

// Save/validate credentials for a storage service
// POST /storage/:service/auth
router.post("/:service/auth", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { service } = req.params;
    const { credential_name, host, port, password, user, database, tls } =
      req.body;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!credential_name) {
      return res.status(400).json({ error: "credential_name is required" });
    }

    // Only redis/supabase services need validation
    if (service === "redis" || service === "redisTrigger") {
      if (!host) {
        return res.status(400).json({ error: "host is required" });
      }

      const credentials = { host, port, password, user, database, tls };

      // Validate credential structure
      const validation = CredentialValidator.validateCredentials(
        "redis",
        credentials,
      );
      if (!validation.isValid) {
        return res.status(400).json({
          error: "Invalid credentials",
          details: validation.errors,
        });
      }

      // Test connection before saving
      logger.info(
        { userId, credential_name, host },
        "Testing Redis connection",
      );
      const testResult = await testRedisConnection(credentials);

      if (!testResult.success) {
        return res.status(400).json({
          error: `Connection failed: ${testResult.error}`,
          details:
            "Please verify your Redis host, port, password, and network connectivity",
        });
      }

      // Save credentials
      const credentialId = await CredentialManager.saveCredentials(
        userId,
        "redis",
        credential_name,
        credentials,
        "api",
      );

      logger.info(
        { userId, credential_name, credentialId },
        "Redis credentials saved successfully",
      );

      res.json({
        success: true,
        credential_id: credentialId,
        message: "Redis connection validated and saved successfully",
      });
    } else if (service === "supabase") {
      const supabaseUrl = String(req.body.supabase_url ?? "").trim();
      const legacyServiceRoleKey = String(req.body.service_role_key ?? "").trim();
      const secretKey = String(req.body.secret_key ?? legacyServiceRoleKey).trim();

      if (!supabaseUrl) {
        return res.status(400).json({ error: "supabase_url is required" });
      }

      if (!secretKey) {
        return res.status(400).json({ error: "secret_key is required" });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(supabaseUrl);
      } catch {
        return res.status(400).json({ error: "supabase_url must be a valid URL" });
      }

      if (parsedUrl.protocol !== "https:") {
        return res.status(400).json({ error: "supabase_url must use HTTPS" });
      }

      const looksLikeJwt = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(secretKey);
      if (!secretKey.startsWith("sb_secret_") && !looksLikeJwt) {
        return res.status(400).json({
          error:
            "secret_key must start with sb_secret_ or be a legacy service_role JWT",
        });
      }

      const client = createClient(supabaseUrl, secretKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { error: probeError } = await client
        .from("_coreza_auth_probe")
        .select("*")
        .limit(1);

      if (probeError) {
        if (probeError.code === "PGRST205" || probeError.code === "42P01") {
          // Valid URL/key; probe table is expected to not exist.
        } else if (
          probeError.code === "PGRST301" ||
          probeError.message.includes("401") ||
          probeError.message.includes("403")
        ) {
          return res
            .status(400)
            .json({ error: "Invalid Supabase URL or Secret Key" });
        } else {
          return res.status(400).json({
            error: `Supabase connection test failed: ${probeError.message}`,
          });
        }
      }

      const credentialId = await CredentialManager.saveCredentials(
        userId,
        "supabase",
        credential_name,
        {
          supabase_url: supabaseUrl,
          secret_key: secretKey,
        },
        "api",
      );

      res.json({
        success: true,
        credential_id: credentialId,
        message: "Supabase connection validated and saved successfully",
      });
    } else {
      // For non-Redis services, just save the credentials
      const credentialId = await CredentialManager.saveCredentials(
        userId,
        service,
        credential_name,
        req.body,
        "api",
      );

      res.json({
        success: true,
        credential_id: credentialId,
        message: `${service} credentials saved successfully`,
      });
    }
  } catch (error: any) {
    logger.error({ err: error }, "Error saving storage credentials");
    res.status(500).json({ error: error.message });
  }
});
// Generic storage operation
// POST /storage/:service/:operation
router.post("/:service/:operation", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const { service } = req.params;
    const { credential_id, operation, ...params } = req.body;

    console.log(`📦 [STORAGE-ROUTE] ${service}/${operation} request`);

    const storageService = getStorageService(service);
    if (!storageService) {
      return res.status(400).json({
        success: false,
        error: `Unsupported storage service: ${service}`,
      });
    }

    const result = await storageService.execute({
      user_id: userId,
      credential_id,
      operation,
      ...params,
    });

    res.status(result.success ? 200 : 400).json(result);
  } catch (error: any) {
    console.error("[STORAGE-ROUTE] Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper routes for Store node
// GET /storage/store/workflows - List workflows for variable selection
router.get("/store/workflows", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { data, error } = await supabase
      .from("workflows")
      .select("id, name")
      .eq("user_id", userId)
      .order("name", { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      workflows: data?.map((w: any) => ({ id: w.id, name: w.name })) ?? [],
    });
  } catch (error: any) {
    logger.error({ err: error }, "Error listing workflows");
    res.status(500).json({ error: "Failed to list workflows" });
  }
});

// GET /storage/store/variables - List stored variables for a workflow
router.get("/store/variables", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflowId } = req.query;
    if (!workflowId) {
      return res.status(400).json({ error: "workflowId is required" });
    }

    const redis = getRedisCache();
    const pattern = buildStoreKey(userId, workflowId as string, "*");
    const keys = await redis.keys(pattern);

    res.json({
      success: true,
      variables: keys.map(extractVariableNameFromKey),
    });
  } catch (error: any) {
    logger.error({ err: error }, "Error listing variables");
    res.status(500).json({ error: "Failed to list variables" });
  }
});

// GET /storage/store/value - Retrieve a value from another workflow
router.get("/store/value", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { workflowId, variable_name } = req.query;

    if (!workflowId || !variable_name) {
      return res
        .status(400)
        .json({ error: "workflowId and variable_name required" });
    }

    const { getStoreValue } = await import("../utils/store");
    const redis = getRedisCache();
    const key = buildStoreKey(
      userId,
      workflowId as string,
      variable_name as string,
    );
    const storedValue = await getStoreValue(redis, key);

    res.json({
      success: true,
      value: storedValue,
    });
  } catch (error: any) {
    logger.error({ err: error }, "Error fetching store value");
    res.status(500).json({ error: "Failed to fetch value" });
  }
});

export default router;
