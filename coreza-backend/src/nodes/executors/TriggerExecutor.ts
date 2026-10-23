import { resultFailure, resultState } from "../../contracts/nodeResult";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import axios from "axios";
import logger from "../../utils/logger";
import { finalizeNodeResult, createErrorOutput } from "../../utils/nodeResultHelpers";

/**
 * TriggerExecutor handles trigger-type nodes (RedisTrigger, AlpacaStreamData, etc.)
 * that set up subscriptions and trigger workflows on events
 */
export class TriggerExecutor implements INodeExecutor {
  readonly category = "Trigger";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    try {
      const nodeName = node.name;
      const userId = context?.userId || input.userId;
      const workflowId = context?.workflowId || input.workflowId;
      const nodeId = node.id;

      if (!userId) {
        return resultFailure("userId is required for trigger nodes", { data: null });
      }

      if (!workflowId) {
        return resultFailure("workflowId is required for trigger nodes", { data: null });
      }

      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      logger.info({ nodeName, workflowId, nodeId }, "Executing trigger node");

      let result: NodeResult;

      switch (nodeName) {
        case "RedisTrigger":
          result = await this.executeRedisTrigger(
            userId,
            workflowId,
            nodeId,
            resolvedParams,
          );
          break;

        case "WebhookTrigger":
        case "TelegramTrigger":
        case "GmailTrigger":
          result = await this.executeWebhookTrigger(
            userId,
            workflowId,
            nodeId,
            resolvedParams,
            node,
          );
          break;

        default:
          if (node.data?.definition?.executionMode === "webhook_listening") {
            result = await this.executeWebhookTrigger(
              userId,
              workflowId,
              nodeId,
              resolvedParams,
              node,
            );
            break;
          }

          return resultFailure(`Unsupported trigger node type: ${nodeName}`, { data: null });
      }

      if (result.status === "error") {
        logger.error(
          { nodeName, error: result.error },
          "Trigger node execution failed",
        );
      }

      const normalized = finalizeNodeResult(result, {
        nodeId: node.id,
        nodeName,
        category: this.category,
        startTime,
      }, "observed");
      return normalized;
    } catch (error) {
      logger.error({ err: error }, "Trigger executor error");

      const errOutput = createErrorOutput(
        error instanceof Error
          ? error
          : typeof error === "object" && error !== null
            ? ((error as any).message ?? JSON.stringify(error))
            : String(error),
        {
          nodeId: node.id,
          nodeName: node.name,
          category: this.category,
          startTime,
        },
      );

      return errOutput;
    }
  }

  private async executeRedisTrigger(
    userId: string,
    workflowId: string,
    nodeId: string,
    params: any,
  ): Promise<NodeResult> {
    try {
      const { credential_id, subscriptionType = "channel", channels } = params;

      if (!credential_id) {
        return resultFailure("credential_id is required for Redis Trigger", { data: null });
      }

      if (!channels) {
        return resultFailure("channels are required for Redis Trigger", { data: null });
      }

      // Parse channels (comma-separated)
      const channelList = channels
        .split(",")
        .map((c: string) => c.trim())
        .filter(Boolean);

      if (channelList.length === 0) {
        return resultFailure("At least one channel is required", { data: null });
      }

      // Send subscription request to market-stream-service
      // Using control message pattern similar to market data
      const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";

      const response = await axios.post(
        `${backendUrl}/redis/trigger/subscribe`,
        {
          user_id: userId,
          workflow_id: workflowId,
          node_id: nodeId,
          credential_id,
          subscription_type: subscriptionType,
          channels: channelList,
        },
      );

      if (!response.data.success) {
        return resultFailure(response.data.error || "Redis subscription failed", { data: null });
      }

      return resultState("listening", { message: `Subscribed to ${channelList.length} Redis ${subscriptionType}(s)`, channels: channelList, subscriptionType });
    } catch (error) {
      logger.error({ err: error }, "Redis trigger execution failed");
      return resultFailure(`Redis trigger failed: ${
          error instanceof Error ? error.message : String(error)
        }`, { data: null });
    }
  }

  private async executeWebhookTrigger(
    userId: string,
    workflowId: string,
    nodeId: string,
    params: any,
    node: WorkflowNode,
  ): Promise<NodeResult> {
    try {
      const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";
      const definition = node.data?.definition;
      const provider =
        params.provider ||
        definition?.provider ||
        (node.name === "WebhookTrigger"
          ? "generic"
          : node.name?.replace(/Trigger$/, "").toLowerCase()) ||
        "generic";

      const response = await axios.post(`${backendUrl}/webhooks/register`, {
        ...params,
        provider,
        user_id: userId,
        workflow_id: workflowId,
        node_id: nodeId,
        credential_id: params.credential_id ?? params.credentialId,
        update_types: params.update_types ?? params.updateTypes,
        secret_token: params.secret_token ?? params.secretToken,
      });

      if (response.data.status === "error") {
        return resultFailure(response.data.error || "Webhook registration failed", { data: null });
      }

      return resultState("listening", { message: "Webhook endpoint is listening", callback_url: response.data.data?.callback_url });
    } catch (error) {
      logger.error({ err: error }, "Webhook trigger execution failed");
      return resultFailure(`Webhook trigger failed: ${
          error instanceof Error ? error.message : String(error)
        }`, { data: null });
    }
  }
}
