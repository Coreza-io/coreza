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
      workflowId: camelWorkflowId,
      node_id,
      nodeId: camelNodeId,
      credential_id,
      credentialId: camelCredentialId,
      update_types,
      updateTypes: camelUpdateTypes,
      secret_token,
      secretToken: camelSecretToken,
      user_id: _ignoredUserId,
      userId: _ignoredCamelUserId,
      nodeName: _ignoredNodeName,
      node_type: _ignoredNodeType,
      workflowSessionId: _ignoredWorkflowSessionId,
      category: _ignoredCategory,
      subCategory: _ignoredSubCategory,
      ...filters
    } = req.body;

    const workflowId = workflow_id ?? camelWorkflowId;
    const nodeId = node_id ?? camelNodeId;
    const credentialId = credential_id ?? camelCredentialId;
    const updateTypes = update_types ?? camelUpdateTypes;
    const secretToken = secret_token ?? camelSecretToken;

    if (!workflowId || !nodeId) {
      return res.status(400).json({
        success: false,
        error: "workflow_id/workflowId and node_id/nodeId are required",
      });
    }

    const callbackUrl = webhookService.generateCallbackUrl(
      userId,
      workflowId,
      nodeId,
      provider,
    );

    // Register with external provider if applicable
    let providerRegistration = null;
    if (provider !== "generic" && !credentialId) {
      return res.status(400).json({
        success: false,
        error: "credential_id/credentialId is required for provider webhooks",
      });
    }

    if (provider !== "generic") {
      providerRegistration = await webhookService.registerWithProvider({
        provider,
        userId,
        credentialId,
        callbackUrl,
        updateTypes,
        secretToken,
        workflowId,
        nodeId,
        filters,
      });

      if (!providerRegistration.success) {
        return res.status(502).json({
          success: false,
          error: providerRegistration.message || "Provider registration failed",
        });
      }
    }

    logger.info(
      { userId, workflowId, nodeId, provider },
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

    const {
      provider,
      credential_id,
      credentialId: camelCredentialId,
      workflow_id,
      workflowId: camelWorkflowId,
      node_id,
      nodeId: camelNodeId,
    } = req.body;

    const credentialId = credential_id ?? camelCredentialId;
    const workflowId = workflow_id ?? camelWorkflowId;
    const nodeId = node_id ?? camelNodeId;

    if (!provider || !credentialId) {
      return res.status(400).json({
        success: false,
        error: "provider and credential_id/credentialId are required",
      });
    }

    const result = await webhookService.unregisterFromProvider({
      provider,
      userId,
      credentialId,
      workflowId,
      nodeId,
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
