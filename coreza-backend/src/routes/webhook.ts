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
import { webhookService } from "../services/WebhookService";
import { getProviderConfig } from "../config/webhookProviders";
import { createLogger } from "../utils/logger";

const router = express.Router();
const logger = createLogger("webhook-routes");

/**
 * Register webhook - generates callback URL and optionally registers with external provider
 * REQUIRES AUTH
 */
router.post("/register", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      provider = "generic",
      workflow_id,
      node_id,
      credential_id,
      update_types,
      secret_token,
    } = req.body;

    if (!workflow_id || !node_id) {
      return res.status(400).json({
        success: false,
        error: "workflow_id and node_id are required",
      });
    }

    const callbackUrl = webhookService.generateCallbackUrl(
      userId,
      workflow_id,
      node_id,
      provider,
    );

    // Register with external provider if applicable
    let providerRegistration = null;
    if (provider !== "generic" && credential_id) {
      providerRegistration = await webhookService.registerWithProvider({
        provider,
        userId,
        credentialId: credential_id,
        callbackUrl,
        updateTypes: update_types,
        secretToken: secret_token,
      });
    }

    logger.info(
      { userId, workflowId: workflow_id, nodeId: node_id, provider },
      "Webhook registered",
    );

    res.json({
      success: true,
      callback_url: callbackUrl,
      status: "listening",
      message:
        providerRegistration?.message ||
        "Webhook endpoint is ready to receive events",
      provider_registered: providerRegistration?.success,
    });
  } catch (error) {
    logger.error({ err: error }, "Error registering webhook");
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * Provider webhook verification (GET) - For providers requiring challenge verification (e.g., WhatsApp)
 * NO AUTH - External services call this endpoint
 * GET /webhooks/:provider/verify
 */
router.get("/:provider/verify", async (req, res) => {
  const { provider } = req.params;

  try {
    const providerConfig = getProviderConfig(provider);

    if (!providerConfig?.verifyChallenge) {
      return res
        .status(404)
        .json({ error: "Provider does not support verification" });
    }

    const result = providerConfig.verifyChallenge(
      req.query as Record<string, any>,
    );

    if (result.valid && result.challenge) {
      logger.info({ provider }, "Webhook verification successful");
      res.status(200).send(result.challenge);
    } else {
      logger.warn({ provider }, "Webhook verification failed");
      res.sendStatus(403);
    }
  } catch (error) {
    logger.error({ err: error, provider }, "Error in webhook verification");
    res.sendStatus(500);
  }
});

/**
 * Unregister webhook from external provider
 * REQUIRES AUTH
 */
router.post("/unregister", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { provider, credential_id } = req.body;

    if (!provider || !credential_id) {
      return res.status(400).json({
        success: false,
        error: "provider and credential_id are required",
      });
    }

    const result = await webhookService.unregisterFromProvider({
      provider,
      userId,
      credentialId: credential_id,
    });

    logger.info({ userId, provider }, "Webhook unregistered");

    res.json(result);
  } catch (error) {
    logger.error({ err: error }, "Error unregistering webhook");
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * Receive incoming webhook events - provider-specific route
 * NO AUTH - External services call this endpoint
 */
router.all(
  "/:provider/incoming/:userId/:workflowId/:nodeId",
  async (req, res) => {
    const { provider, userId, workflowId, nodeId } = req.params;

    try {
      // Process webhook asynchronously
      // We return 200 immediately to prevent external service retries
      webhookService.handleIncoming({
        provider,
        userId,
        workflowId,
        nodeId,
        method: req.method,
        headers: req.headers as Record<string, any>,
        body: req.body,
        query: req.query as Record<string, any>,
      });

      // Always return 200 OK to external services
      res.status(200).json({ received: true });
    } catch (error) {
      logger.error({ err: error, provider }, "Error in webhook endpoint");
      // Still return 200 to prevent retries
      res.status(200).json({ received: true });
    }
  },
);

/**
 * Get webhook status
 * REQUIRES AUTH
 */
router.get("/status/:workflowId/:nodeId", requireAuth, async (req, res) => {
  try {
    const { workflowId, nodeId } = req.params;

    const status = await webhookService.getStatus(workflowId, nodeId);

    res.json(status);
  } catch (error) {
    logger.error({ err: error }, "Error getting webhook status");
    res.status(500).json({
      active: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
