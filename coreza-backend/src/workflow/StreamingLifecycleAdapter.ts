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
import { RedisKeys } from "../infra/redisKeys";
import { buildCryptoSymbols } from "../utils/symbolHelpers";
import logger from "../utils/logger";
import { MAX_LISTENERS_PER_USER } from "../config/streaming";

function toMarketSource(
  source: MarketSource | `${MarketSource}_${string}` | null,
): MarketSource | null {
  if (!source) {
    return null;
  }

  return getSourceMapping(source).gatewaySource;
}

export class StreamingLifecycleAdapter {
  private async deleteByPattern(pattern: string): Promise<void> {
    const redis = getRedisCache();
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

      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  }

  private async clearSessionData(
    userId: string,
    workflowId: string,
  ): Promise<void> {
    const redis = getRedisCache();
    const keysToDelete = [
      RedisKeys.strategyStream(userId, workflowId),
      RedisKeys.portfolioFillsStream(userId, workflowId),
      RedisKeys.portfolioSnapshotLatest(userId, workflowId),
    ];

    await redis.del(...keysToDelete);
    await this.deleteByPattern(RedisKeys.order(userId, workflowId, "*"));
    await this.deleteByPattern(RedisKeys.orderReverse(userId, workflowId, "*"));
  }

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
          stream_type?: string[] | string;
          credential_id?: string;
          feed?: string;
          environment?: string;
          assetType?: string;
          marketType?: string;
          contractType?: string;
          interval?: string;
          depth_levels?: number;
          crypto_base?: string;
          crypto_quote?: string;
        };
      }
    ).values || {}) as {
      scope?: string;
      onlyClosedBars?: boolean;
      symbols?: unknown;
      stream_type?: string[] | string;
      credential_id?: string;
      feed?: string;
      environment?: string;
      assetType?: string;
      marketType?: string;
      contractType?: string;
      interval?: string;
      depth_levels?: number;
      crypto_base?: string;
      crypto_quote?: string;
    };

    await redis.sadd(
      REDIS_CHANNELS.activeStreamingWorkflows(userId),
      workflowId,
    );

    const sourceId = resolveStreamSourceId(triggerNode);
    if (!sourceId) {
      throw createError("Unknown streaming source", 400);
    }

    // --- Resolve symbols (standard + crypto fallback) ---
    let symbols = parseSymbols(nodeValues.symbols);
    if (symbols.length === 0 && nodeValues.assetType === "crypto") {
      symbols = buildCryptoSymbols(
        nodeValues.assetType,
        nodeValues.crypto_base,
        nodeValues.crypto_quote,
      );
    }

    const streamType = Array.isArray(nodeValues.stream_type)
      ? nodeValues.stream_type
      : typeof nodeValues.stream_type === "string"
        ? nodeValues.stream_type
            .split(",")
            .map((streamType) => streamType.trim())
        : [];

    const hasOrderUpdate = streamType.includes("order_update");

    const { marketstreamType, tradingstreamType } = streamType.reduce(
      (acc, t: string) => {
        if (t === "order_update") {
          acc.tradingstreamType.push(t);
        } else {
          acc.marketstreamType.push(t);
        }
        return acc;
      },
      {
        marketstreamType: [] as string[],
        tradingstreamType: [] as string[],
      },
    );

    const environment = nodeValues.environment as string;
    const subscriptionScope: "workflow" | "global" =
      nodeValues.scope === "global" ? "global" : "workflow";

    // --- Subscribe FIRST, then wait for readiness, then register ---

    // 1. Subscribe to trading source for order updates
    if (hasOrderUpdate) {
      const baseName = triggerNode.subCategory;
      const tradingSourceId = `${baseName}_trading`;
      await SubscriptionService.subscribe({
        source: tradingSourceId,
        userId,
        workflowId,
        nodeId: triggerNode.id,
        credentialId: nodeValues.credential_id || "",
        symbols: ["*"],
        streamType: ["order_update"],
        environment,
        assetType: nodeValues.assetType,
        marketType: nodeValues.marketType,
        contractType: nodeValues.contractType,
        scope: subscriptionScope,
        targetWorkflowId: workflowId,
      });

      // Wait for trading subscription readiness
      const tradingReady = await SubscriptionService.waitForSubscriptionReady({
        userId,
        source: tradingSourceId,
        environment,
        scope: subscriptionScope,
        workflowId,
      });
      if (!tradingReady) {
        logger.warn(
          {
            userId,
            workflowId,
            source: tradingSourceId,
          },
          "Trading subscription readiness timed out; continuing in market-only mode",
        );
      }
    }

    // 2. Subscribe to market/crypto streams
    if (
      symbols.length > 0 &&
      (marketstreamType.length > 0 || !hasOrderUpdate)
    ) {
      const marketSubscribeParams = {
        source: sourceId,
        userId,
        workflowId,
        nodeId: triggerNode.id,
        credentialId: nodeValues.credential_id || "",
        symbols,
        streamType: marketstreamType.length > 0 ? marketstreamType : undefined,
        feed: nodeValues.feed,
        environment,
        assetType: nodeValues.assetType,
        marketType: nodeValues.marketType,
        contractType: nodeValues.contractType,
        interval: nodeValues.interval,
        depth_levels: nodeValues.depth_levels,
        scope: subscriptionScope,
        targetWorkflowId: workflowId,
      };

      await SubscriptionService.subscribe(marketSubscribeParams);

      // Wait for market subscription readiness
      const marketReady = await SubscriptionService.waitForSubscriptionReady({
        userId,
        source: sourceId,
        environment,
        scope: subscriptionScope,
        workflowId,
        timeoutMs: 15000,
      });
      if (!marketReady) {
        logger.warn(
          {
            userId,
            workflowId,
            source: sourceId,
          },
          "Market subscription readiness timed out on first attempt; retrying subscribe once",
        );

        await SubscriptionService.subscribe(marketSubscribeParams);
        const marketRetryReady =
          await SubscriptionService.waitForSubscriptionReady({
            userId,
            source: sourceId,
            environment,
            scope: subscriptionScope,
            workflowId,
            timeoutMs: 10000,
          });

        if (!marketRetryReady) {
          throw new Error(
            `Activation failed: Market subscription readiness timed out for source ${sourceId}. The broker gateway may be slow to connect. Please try again.`,
          );
        }
      }
    }

    // Rate limit check for test listener
    const allowed =
      await RegistrationService.checkAndIncrementListenerCount(userId);

    if (!allowed) {
      throw new Error(
        `⚠️ [ExecuteStreamNode] User ${userId} exceeded max test listeners (${MAX_LISTENERS_PER_USER})`,
      );
    }

    // Create listener
    const listenerKey = await RegistrationService.createListener({
      userId,
      workflowId,
      nodeId: triggerNode.id,
      source: sourceId,
      mode: nodeValues.mode,
      scope: nodeValues.scope,
      environment,
      filterSymbols: symbols,
      filterTypes: nodeValues.stream_type,
      assetType: nodeValues.assetType,
      marketType: nodeValues.marketType,
      contractType: nodeValues.contractType,
      interval: nodeValues.interval,
      depth_levels: nodeValues.depth_levels,
    });

    // 3. NOW register the workflow (subscriptions are materialized)
    await RegistrationService.publishRegisterWorkflow({
      userId,
      workflowId,
      nodeId: triggerNode.id,
      source: sourceId,
      scope: subscriptionScope,
      environment,
      onlyClosedBars: nodeValues.onlyClosedBars ?? true,
      isLive: true,
    });

    await this.clearSessionData(userId, workflowId);
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
    await this.clearSessionData(userId, workflowId);
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
    await this.clearSessionData(userId, workflowId);
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
    let sessionDataCleared = false;

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
        sessionDataCleared = true;
      }
    }

    if (!options?.skipSubscriptionCleanup) {
      await this.cleanupWorkflowSubscriptions(userId, workflowId);
    }

    if (!sessionDataCleared) {
      await this.clearSessionData(userId, workflowId);
    }
  }
}
