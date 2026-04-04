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

import { supabase } from "../config/supabase";
import { bullMqJobQueue } from "../infra/jobQueue/jobQueueManager";
import { createLogger } from "../utils/logger";
import { validateWebhookAuth } from "../utils/webhookAuth";
import {
  getProviderConfig,
  verifyProviderSignature,
} from "../config/webhookProviders";
import CredentialManager from "../utils/credentialManager";

const logger = createLogger("WebhookService");

export interface NormalizedWebhookPayload {
  timestamp: string;
  method: string;
  headers: Record<string, any>;
  body: any;
  query: Record<string, any>;
  raw: any;
}

export class WebhookService {
  private static instance: WebhookService;

  private constructor() {}

  static getInstance(): WebhookService {
    if (!WebhookService.instance) {
      WebhookService.instance = new WebhookService();
    }
    return WebhookService.instance;
  }

  /**
   * Generate callback URL for webhook
   */
  generateCallbackUrl(
    userId: string,
    workflowId: string,
    nodeId: string,
    provider: string = "generic",
  ): string {
    const baseUrl = process.env.NGROK_URL;
    return `${baseUrl}/webhooks/${provider}/incoming/${userId}/${workflowId}/${nodeId}`;
  }

  /**
   * Register webhook with external provider (if applicable)
   */
  async registerWithProvider(params: {
    provider: string;
    userId: string;
    credentialId: string;
    callbackUrl: string;
    updateTypes?: string[];
    secretToken?: string;
  }): Promise<{ success: boolean; message?: string; webhookInfo?: any }> {
    const {
      provider,
      userId,
      credentialId,
      callbackUrl,
      updateTypes,
      secretToken,
    } = params;

    const providerConfig = getProviderConfig(provider);
    if (!providerConfig || !providerConfig.externalApi?.setWebhook) {
      return {
        success: true,
        message: "Provider does not require external registration",
      };
    }

    try {
      // Fetch credentials
      const { credentials } = await CredentialManager.getCredentials(
        userId,
        provider,
        credentialId,
      );
      if (!credentials) {
        return { success: false, message: "Credentials not found" };
      }

      const creds = credentials?.client_json;
      if (!creds) {
        return {
          success: false,
          message: "no credentials found",
        };
      }

      // Register webhook with provider
      const result = await providerConfig.externalApi.setWebhook({
        creds,
        callbackUrl,
        secretToken,
        allowedUpdates: updateTypes,
      });

      return {
        success: result.success,
        message:
          result.description ||
          (result.success
            ? "Webhook registered successfully"
            : "Failed to register webhook"),
      };
    } catch (error) {
      logger.error(
        { err: error, provider },
        "Error registering webhook with provider",
      );
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Unregister webhook from external provider
   */
  async unregisterFromProvider(params: {
    provider: string;
    userId: string;
    credentialId: string;
  }): Promise<{ success: boolean; message?: string }> {
    const { provider, userId, credentialId } = params;

    const providerConfig = getProviderConfig(provider);
    if (!providerConfig || !providerConfig.externalApi?.deleteWebhook) {
      return {
        success: true,
        message: "Provider does not require external unregistration",
      };
    }

    try {
      const credentials = await CredentialManager.getCredentials(
        userId,
        provider,
        credentialId,
      );
      if (!credentials) {
        return { success: false, message: "Credentials not found" };
      }

      const botToken = credentials.bot_token;
      if (!botToken) {
        return {
          success: false,
          message: "Bot token not found in credentials",
        };
      }

      const success = await providerConfig.externalApi.deleteWebhook(botToken);

      return {
        success,
        message: success
          ? "Webhook unregistered successfully"
          : "Failed to unregister webhook",
      };
    } catch (error) {
      logger.error(
        { err: error, provider },
        "Error unregistering webhook from provider",
      );
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Handle incoming webhook request with dual execution paths
   */
  async handleIncoming(params: {
    provider?: string;
    userId: string;
    workflowId: string;
    nodeId: string;
    method: string;
    headers: Record<string, any>;
    body: any;
    query: Record<string, any>;
  }): Promise<void> {
    const {
      provider = "generic",
      userId,
      workflowId,
      nodeId,
      method,
      headers,
      body,
      query,
    } = params;

    logger.info(
      { workflowId, nodeId, method, provider },
      "Incoming webhook request",
    );

    try {
      // Fetch workflow from database
      const { data: workflow, error: workflowError } = await supabase
        .from("workflows")
        .select("*")
        .eq("id", workflowId)
        .eq("user_id", userId)
        .single();

      if (workflowError || !workflow) {
        logger.warn({ workflowId, nodeId }, "Workflow not found");
        return; // Return 200 to prevent external service retries
      }

      // Find node configuration in workflow
      const nodes = workflow.nodes as any[];
      const node = nodes.find((n: any) => n.id === nodeId);

      if (!node) {
        logger.warn({ workflowId, nodeId }, "Node not found in workflow");
        return;
      }

      // Extract node configuration
      const nodeConfig = node.values || {};

      const authResult = await validateWebhookAuth(nodeConfig, headers);
      if (!authResult.valid) {
        logger.warn(
          { workflowId, nodeId, provider, error: authResult.error },
          "Webhook authentication failed",
        );
        return;
      }

      // Apply filters (provider-aware)
      if (!this.applyFilters(nodeConfig, method, headers, body, provider)) {
        logger.info(
          { workflowId, nodeId, provider },
          "Webhook filtered out by node configuration",
        );
        return;
      }

      // Normalize payload (provider-aware)
      const normalizedPayload = this.normalizePayload(
        method,
        headers,
        body,
        query,
        provider,
      );

      if (workflow.is_active) {
        // MODE 2: Backend execution via BullMQ (Activated workflow)
        logger.info(
          { workflowId, nodeId, mode: "backend" },
          "Webhook triggering backend execution for active workflow",
        );

        // Create workflow run with snapshot of current workflow state
        const { data: run, error: runError } = await supabase
          .from("workflow_runs")
          .insert({
            workflow_id: workflowId,
            status: "queued",
            initiated_by: userId,
            nodes: workflow.nodes,
            edges: workflow.edges,
            node_count: Array.isArray(workflow.nodes)
              ? workflow.nodes.length
              : 0,
            edge_count: Array.isArray(workflow.edges)
              ? workflow.edges.length
              : 0,
          })
          .select()
          .single();

        if (runError) {
          logger.error({ err: runError }, "Failed to create workflow run");
          return;
        }

        // Queue workflow execution with webhook payload as initial input
        await bullMqJobQueue.addWorkflowExecution({
          runId: run.id,
          workflowId,
          userId,
          nodes: workflow.nodes,
          edges: workflow.edges,
          trigger: "webhook",
          executionMode: "manual",
          initialInput: {
            webhookPayload: normalizedPayload,
          },
        });

        logger.info(
          { workflowId, nodeId, runId: run.id },
          "Workflow queued for backend execution",
        );
      } else {
        // MODE 1: Push to frontend via WebSocket (Manual run)
        logger.info(
          { workflowId, nodeId, mode: "frontend" },
          "Webhook pushing to frontend for manual run",
        );

        const { getRedisQueue } = await import("../config/redis");
        const redis = getRedisQueue();

        await redis.publish(
          `ws:user:${userId}`,
          JSON.stringify({
            type: "webhook_event",
            workflowId,
            nodeId,
            payload: normalizedPayload,
            timestamp: new Date().toISOString(),
          }),
        );

        logger.info(
          { workflowId, nodeId, userId },
          "Webhook data pushed to frontend via WebSocket",
        );
      }
    } catch (error) {
      logger.error({ err: error }, "Error handling incoming webhook");
      // Still return successfully to prevent external retries
    }
  }

  /**
   * Apply filters based on node configuration (provider-aware)
   */
  private applyFilters(
    nodeConfig: any,
    method: string,
    headers: Record<string, any>,
    body: any,
    provider: string = "generic",
  ): boolean {
    const providerConfig = getProviderConfig(provider);

    // Verify signature/token if secret is configured
    const secret = nodeConfig.secret || nodeConfig.secretToken;
    if (secret && providerConfig) {
      const isValid = verifyProviderSignature(
        providerConfig,
        secret,
        headers,
        body,
      );
      if (!isValid) {
        logger.warn({ provider }, "Invalid signature/token");
        return false;
      }
    }

    // Filter by HTTP method (single selection or ALL) - only for generic webhooks
    if (provider === "generic") {
      const allowedMethod = nodeConfig.httpMethod || "ALL";
      if (allowedMethod !== "ALL" && method.toUpperCase() !== allowedMethod) {
        logger.info(
          { method, allowed: allowedMethod },
          "HTTP method not allowed",
        );
        return false;
      }
    }

    // Filter by Telegram update types if configured
    if (
      provider === "telegram" &&
      nodeConfig.updateTypes &&
      Array.isArray(nodeConfig.updateTypes)
    ) {
      if (!nodeConfig.updateTypes.includes("all")) {
        const updateType = body.message
          ? "message"
          : body.edited_message
            ? "edited_message"
            : body.channel_post
              ? "channel_post"
              : body.callback_query
                ? "callback_query"
                : body.inline_query
                  ? "inline_query"
                  : "unknown";

        if (!nodeConfig.updateTypes.includes(updateType)) {
          logger.info(
            { updateType, allowed: nodeConfig.updateTypes },
            "Update type not allowed",
          );
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Normalize webhook payload to standard format (provider-aware)
   */
  private normalizePayload(
    method: string,
    headers: Record<string, any>,
    body: any,
    query: Record<string, any>,
    provider: string = "generic",
  ): any {
    const providerConfig = getProviderConfig(provider);

    if (providerConfig) {
      return providerConfig.normalizePayload({ method, headers, body, query });
    }

    // Fallback to generic normalization
    return {
      timestamp: new Date().toISOString(),
      method,
      headers: {
        ...headers,
        authorization: headers.authorization ? "[REDACTED]" : undefined,
      },
      body,
      query,
      raw: { method, headers, body, query },
    };
  }

  /**
   * Get webhook status
   */
  async getStatus(
    workflowId: string,
    nodeId: string,
  ): Promise<{
    active: boolean;
    callbackUrl?: string;
    error?: string;
  }> {
    try {
      const { data: workflow, error } = await supabase
        .from("workflows")
        .select("nodes, is_active, user_id")
        .eq("id", workflowId)
        .single();

      if (error || !workflow) {
        return { active: false, error: "Workflow not found" };
      }

      const nodes = workflow.nodes as any[];
      const node = nodes.find((n: any) => n.id === nodeId);

      if (!node) {
        return { active: false, error: "Node not found" };
      }

      const callbackUrl = this.generateCallbackUrl(
        workflow.user_id,
        workflowId,
        nodeId,
      );

      return {
        active: workflow.is_active,
        callbackUrl,
      };
    } catch (error) {
      logger.error({ err: error }, "Error getting webhook status");
      return {
        active: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export const webhookService = WebhookService.getInstance();
