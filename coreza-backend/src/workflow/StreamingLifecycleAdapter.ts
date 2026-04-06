import { getRedisCache } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import { createError } from "../middleware/errorHandler";
import { getSourceMapping, MarketSource } from "../brokers";
import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { RegistrationService } from "../services/RegistrationService";
import { bullMqJobQueue as jobQueue } from "../infra/jobQueue/jobQueueManager";
import { SubscriptionService } from "../services/SubscriptionService";
import { parseSymbols, resolveStreamSourceId } from "./subscriptionPolicy";
import { classifyTrigger, findStreamingDataNodes } from "./triggerClassifier";

function toMarketSource(
  source: MarketSource | `${MarketSource}_${string}` | null,
): MarketSource | null {
  if (!source) {
    return null;
  }

  return getSourceMapping(source).gatewaySource;
}

export class StreamingLifecycleAdapter {
  async activateStreaming(
    userId: string,
    workflowId: string,
    triggerNode: WorkflowNode,
    allNodes: WorkflowNode[],
    allEdges: WorkflowEdge[],
    executionId?: string,
  ): Promise<string> {
    const redis = getRedisCache();
    const nodeValues = ((
      triggerNode as WorkflowNode & {
        values?: {
          scope?: string;
          onlyClosedBars?: boolean;
          symbols?: unknown;
          stream_types?: string[] | string;
          credential_id?: string;
          feed?: string;
          environment?: string;
          asset_type?: string;
          interval?: string;
          depth_levels?: number;
        };
      }
    ).values || {}) as {
      scope?: string;
      onlyClosedBars?: boolean;
      symbols?: unknown;
      stream_types?: string[] | string;
      credential_id?: string;
      feed?: string;
      environment?: string;
      asset_type?: string;
      interval?: string;
      depth_levels?: number;
    };

    await redis.sadd(
      REDIS_CHANNELS.activeStreamingWorkflows(userId),
      workflowId,
    );

    const sourceId = resolveStreamSourceId(triggerNode);
    if (!sourceId) {
      throw createError("Unknown streaming source", 400);
    }

    await RegistrationService.publishRegisterWorkflow({
      userId,
      workflowId,
      nodeId: triggerNode.id,
      source: sourceId,
      scope: nodeValues.scope || "workflow",
      onlyClosedBars: nodeValues.onlyClosedBars ?? true,
      isLive: true,
    });

    const symbols = parseSymbols(nodeValues.symbols);
    const streamTypes = Array.isArray(nodeValues.stream_types)
      ? nodeValues.stream_types
      : typeof nodeValues.stream_types === "string"
        ? nodeValues.stream_types
            .split(",")
            .map((streamType) => streamType.trim())
        : [];
    const hasOrderUpdate = streamTypes.includes("order_update");
    const marketStreamTypes = streamTypes.filter(
      (streamType) => streamType !== "order_update",
    );

    if (hasOrderUpdate) {
      const baseName = triggerNode.name;
      const tradingSource = baseName?.includes("Binance")
        ? "binance_trading"
        : "alpaca_trading";
      await SubscriptionService.subscribe({
        source: tradingSource,
        userId,
        workflowId,
        nodeId: triggerNode.id,
        credentialId: nodeValues.credential_id || "",
        //symbols,
        symbols: ["*"],
        streamTypes: ["order_update"],
        scope: nodeValues.scope || "workflow",
        targetWorkflowId: workflowId,
      });
    }

    if (
      symbols.length > 0 &&
      (marketStreamTypes.length > 0 || !hasOrderUpdate)
    ) {
      await SubscriptionService.subscribe({
        source: sourceId,
        userId,
        workflowId,
        nodeId: triggerNode.id,
        credentialId: nodeValues.credential_id || "",
        symbols,
        streamTypes:
          marketStreamTypes.length > 0 ? marketStreamTypes : undefined,
        feed: nodeValues.feed,
        environment: nodeValues.environment,
        assetType: nodeValues.asset_type,
        interval: nodeValues.interval,
        depth_levels: nodeValues.depth_levels,
        scope: nodeValues.scope || "workflow",
        targetWorkflowId: workflowId,
      });
    }

    await jobQueue.startWorkflowRunner(
      workflowId,
      userId,
      allNodes,
      allEdges,
      executionId,
    );
    return sourceId;
  }

  async deactivateStreaming(userId: string, workflowId: string): Promise<void> {
    const redis = getRedisCache();

    await redis.srem(
      REDIS_CHANNELS.activeStreamingWorkflows(userId),
      workflowId,
    );
    await redis.del(REDIS_CHANNELS.workflowStreamFilter(userId, workflowId));
    await RegistrationService.publishUnregisterWorkflow({
      userId,
      workflowId,
      isTestListener: false,
    });

    // Stop the in-memory WorkflowRunner so it doesn't keep persisting
    // data under the old runnerInstanceId after deactivation.
    await jobQueue.stopWorkflowRunner(workflowId);
  }

  async unsubscribeStreamingNodes(
    userId: string,
    workflowId: string,
    nodes: WorkflowNode[],
  ): Promise<void> {
    const streamingNodes = findStreamingDataNodes(nodes);

    for (const node of streamingNodes) {
      const nodeValues = node.values || node.data?.values || {};
      const symbolArray = parseSymbols(nodeValues.symbols);
      const sourceId = toMarketSource(resolveStreamSourceId(node));

      if (!sourceId) {
        continue;
      }

      await SubscriptionService.unsubscribe({
        source: sourceId,
        userId,
        workflowId,
        symbols: symbolArray,
      });
    }
  }

  async unregisterStreamingTriggers(
    userId: string,
    workflowId: string,
  ): Promise<void> {
    await RegistrationService.publishUnregisterWorkflow({ userId, workflowId });
    await jobQueue.stopWorkflowRunner(workflowId);
  }

  async cleanupWorkflowSubscriptions(
    userId: string,
    workflowId: string,
  ): Promise<void> {
    const redis = getRedisCache();
    const pattern = `md:user:${userId}:subscription:scope:workflow:${workflowId}:*:symbols`;

    // Key structure: md:user:{userId}:subscription:scope:workflow:{workflowId}:{source}:symbols
    //                 0    1     2         3        4       5          6          7        8
    const SOURCE_INDEX = 7;

    let cursor = "0";

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;

      for (const key of keys) {
        const symbols = await redis.smembers(key);
        const source = toMarketSource(
          key.split(":")[SOURCE_INDEX] as
            | MarketSource
            | `${MarketSource}_${string}`,
        );

        if (symbols.length > 0 && source) {
          await SubscriptionService.unsubscribe({
            source,
            userId,
            workflowId,
            symbols,
            scope: "workflow",
            targetWorkflowId: workflowId,
          });
        }

        await redis.del(key);
      }
    } while (cursor !== "0");
  }

  async fullCleanup(
    userId: string,
    workflowId: string,
    nodes: WorkflowNode[],
    isActive: boolean,
    options?: {
      skipSubscriptionCleanup?: boolean;
    },
  ): Promise<void> {
    const redis = getRedisCache();

    await redis.srem(
      REDIS_CHANNELS.activeStreamingWorkflows(userId),
      workflowId,
    );
    await redis.del(REDIS_CHANNELS.workflowStreamFilter(userId, workflowId));

    if (isActive) {
      await this.unsubscribeStreamingNodes(userId, workflowId, nodes);

      const hasStreamingTrigger = nodes.some(
        (node) => classifyTrigger(node) === "streaming",
      );
      if (hasStreamingTrigger) {
        await this.unregisterStreamingTriggers(userId, workflowId);
      }
    }

    if (!options?.skipSubscriptionCleanup) {
      await this.cleanupWorkflowSubscriptions(userId, workflowId);
    }
  }
}
