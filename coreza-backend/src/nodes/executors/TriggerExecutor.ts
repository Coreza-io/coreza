import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import axios from "axios";
import logger from "../../utils/logger";

/**
 * TriggerExecutor handles trigger-type nodes (RedisTrigger, AlpacaStreamData, etc.)
 * that set up subscriptions and trigger workflows on events
 */
export class TriggerExecutor implements INodeExecutor {
  readonly category = "Trigger";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const nodeType = node.type || node.name;
      const userId = context?.userId || input.userId;
      const workflowId = context?.workflowId || input.workflowId;
      const nodeId = node.id;

      if (!userId) {
        return {
          success: false,
          error: "userId is required for trigger nodes",
        };
      }

      if (!workflowId) {
        return {
          success: false,
          error: "workflowId is required for trigger nodes",
        };
      }

      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      logger.info(
        { nodeType, workflowId, nodeId },
        "Executing trigger node"
      );

      let result: NodeResult;

      switch (nodeType) {
        case "RedisTrigger":
          result = await this.executeRedisTrigger(
            userId,
            workflowId,
            nodeId,
            resolvedParams
          );
          break;

        default:
          return {
            success: false,
            error: `Unsupported trigger node type: ${nodeType}`,
          };
      }

      if (!result.success) {
        logger.error(
          { nodeType, error: result.error },
          "Trigger node execution failed"
        );
      }

      return result;
    } catch (error) {
      logger.error({ err: error }, "Trigger executor error");
      return {
        success: false,
        error: `Trigger execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private async executeRedisTrigger(
    userId: string,
    workflowId: string,
    nodeId: string,
    params: any
  ): Promise<NodeResult> {
    try {
      const { credential_id, subscriptionType = "channel", channels } = params;

      if (!credential_id) {
        return {
          success: false,
          error: "credential_id is required for Redis Trigger",
        };
      }

      if (!channels) {
        return {
          success: false,
          error: "channels are required for Redis Trigger",
        };
      }

      // Parse channels (comma-separated)
      const channelList = channels
        .split(",")
        .map((c: string) => c.trim())
        .filter(Boolean);

      if (channelList.length === 0) {
        return {
          success: false,
          error: "At least one channel is required",
        };
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
        }
      );

      if (!response.data.success) {
        return {
          success: false,
          error: response.data.error || "Redis subscription failed",
        };
      }

      return {
        success: true,
        message: `Subscribed to ${channelList.length} Redis ${subscriptionType}(s)`,
        channels: channelList,
        subscriptionType,
        status: "listening",
      };
    } catch (error) {
      logger.error({ err: error }, "Redis trigger execution failed");
      return {
        success: false,
        error: `Redis trigger failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
