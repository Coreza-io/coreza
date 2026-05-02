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
import { OrderOwnerRegistry } from "../services/OrderOwnerRegistry";

const ORDER_UPDATE_MARKERS = new Set([
  "trade_updates",
  "ORDER_TRADE_UPDATE",
  "executionReport",
]);

function toMarketSource(
  source: MarketSource | `${MarketSource}_${string}` | null,
): MarketSource | null {
  if (!source) {
    return null;
  }

  return getSourceMapping(source).gatewaySource;
}

function getTradingNativeStreams(
  source: string,
  marketType?: string,
): string[] {
  if (source === "alpaca_trading") {
    return ["trade_updates"];
  }

  if (source === "binance_trading") {
    return marketType === "spot"
      ? [
          "executionReport",
          "outboundAccountPosition",
          "balanceUpdate",
          "listenKeyExpired",
        ]
      : [
          "ORDER_TRADE_UPDATE",
          "ALGO_UPDATE",
          "ACCOUNT_UPDATE",
          "ACCOUNT_CONFIG_UPDATE",
          "MARGIN_CALL",
          "listenKeyExpired",
        ];
  }

  return [];
}

function isTradingSource(source: string): boolean {
  return source === "alpaca_trading" || source === "binance_trading";
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
    const fillStreamKey = RedisKeys.portfolioFillsStream(userId, workflowId);
    const snapshotKey = RedisKeys.portfolioSnapshotLatest(userId, workflowId);
    const keysToDelete = [
      RedisKeys.strategyStream(userId, workflowId),
      fillStreamKey,
      snapshotKey,
    ];

    await redis.del(...keysToDelete);
    await this.deleteByPattern(RedisKeys.order(userId, workflowId, "*"));
    await this.deleteByPattern(RedisKeys.orderReverse(userId, workflowId, "*"));

    const activeStreamsKey = RedisKeys.userActiveFillStreams(userId);
    const activeSnapshotKeysKey = RedisKeys.userActiveSnapshotKeys(userId);

    await redis.srem(activeStreamsKey, fillStreamKey);
    await redis.srem(activeSnapshotKeysKey, snapshotKey);

    const [remainingStreams, remainingSnapshots] = await Promise.all([
      redis.scard(activeStreamsKey),
      redis.scard(activeSnapshotKeysKey),
    ]);

    if (remainingStreams === 0) {
      await redis.del(activeStreamsKey);
      await redis.srem(RedisKeys.registryFillsActive(), userId);
    }

    if (remainingSnapshots === 0) {
      await redis.del(activeSnapshotKeysKey);
      await redis.srem(RedisKeys.registrySnapshotsActive(), userId);
    }
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
    const ORDER_UPDATE_MARKERS = new Set([
      "trade_updates",
      "ORDER_TRADE_UPDATE",
      "executionReport",
    ]);
    // Split trading lifecycle marker from market stream types
    const hasOrderUpdate = streamType.some((streamName) =>
      ORDER_UPDATE_MARKERS.has(streamName),
    );

    const { marketstreamType, tradingstreamType } = streamType.reduce(
      (acc, t: string) => {
        if (ORDER_UPDATE_MARKERS.has(t)) {
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
        streamType: tradingstreamType,
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
      symbols: symbols,
      streamTypes: nodeValues.stream_type,
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
      symbols: symbols,
      streamTypes: nodeValues.stream_type,
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
    await OrderOwnerRegistry.cleanupByWorkflow(workflowId);
    await this.cleanupWorkflowListeners(userId, workflowId);
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

      const streamTypes = Array.isArray(nodeValues.stream_type)
        ? nodeValues.stream_type
        : typeof nodeValues.stream_type === "string"
          ? nodeValues.stream_type
              .split(",")
              .map((streamType: string) => streamType.trim())
          : [];
      // If order_update is included, also unsubscribe from trading source
      const ORDER_UPDATE_MARKERS = new Set([
        "trade_updates",
        "ORDER_TRADE_UPDATE",
        "executionReport",
      ]);
      // Split trading lifecycle marker from market stream types
      const hasOrderUpdate = streamTypes.some((streamName) =>
        ORDER_UPDATE_MARKERS.has(streamName),
      );
      const { marketstreamType, tradingstreamType } = streamTypes.reduce(
        (acc, t: string) => {
          if (ORDER_UPDATE_MARKERS.has(t)) {
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

      if (hasOrderUpdate) {
        //const tradingSourceId = `${source}_trading`;
        await SubscriptionService.unsubscribe({
          source: sourceId as any,
          userId,
          workflowId: workflowId,
          credentialId: nodeValues.credential_id,
          symbols: symbolArray,
          streamType: tradingstreamType,
          scope: nodeValues.scope,
          environment: nodeValues.environment,
          targetWorkflowId: workflowId,
        });
      }

      let result: any;
      // Market unsubscribe
      if (marketstreamType.length > 0) {
        await SubscriptionService.unsubscribe({
          source: sourceId,
          userId,
          workflowId,
          nodeId: node.id,
          credentialId: nodeValues.credential_id as string,
          symbols: symbolArray,
          streamType: marketstreamType,
          feed: nodeValues.feed as string,
          environment: nodeValues.environment as string,
          assetType: nodeValues.assetType as string,
          marketType: nodeValues.marketType as string,
          contractType: nodeValues.contractType as string,
          interval: nodeValues.interval as string,
          depth_levels: nodeValues.depth_levels as string,
          scope: nodeValues.scope,
          targetWorkflowId: workflowId,
        });
      }
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

  private async cleanupWorkflowListeners(
    userId: string,
    workflowId: string,
  ): Promise<void> {
    const redis = getRedisCache();
    const userListenersKey = REDIS_CHANNELS.userActiveListeners(userId);
    const listenerKeys = await redis.smembers(userListenersKey);
    const workflowPrefix = REDIS_CHANNELS.Listener(userId, workflowId, "");

    const workflowListenerKeys = listenerKeys.filter((key) =>
      key.startsWith(workflowPrefix),
    );

    for (const listenerKey of workflowListenerKeys) {
      const nodeId = listenerKey.slice(workflowPrefix.length);
      if (!nodeId) {
        continue;
      }

      await RegistrationService.deleteListener(userId, workflowId, nodeId);
    }
  }

  async cleanupWorkflowSubscriptions(
    userId: string,
    workflowId: string,
  ): Promise<void> {
    const redis = getRedisCache();
    const pattern = `md:user:${userId}:subscription:scope:workflow:${workflowId}:*:streams`;

    // Key structure: md:user:{userId}:subscription:scope:workflow:{workflowId}:{source}:{environment}:streams
    //                 0    1     2         3        4       5          6          7        8
    const SOURCE_INDEX = 7;
    const ENV_INDEX = 8;

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
        const streams = await redis.smembers(key);
        const sourceId = key.split(":")[SOURCE_INDEX];
        const environment = key.split(":")[ENV_INDEX];
        const source = sourceId.split("_")[0];

        // Split trading lifecycle marker from market stream types
        const isOrderUpdate = streams.some((streamName) =>
          ORDER_UPDATE_MARKERS.has(streamName),
        );

        let symbols: string[] = [];
        let streamTypes: string[] = [];
        let contractType: string | undefined;
        let interval: string | undefined;

        if (!isOrderUpdate) {
          const parsedStreams = streams.map((stream) => {
            const [symbolPart, streamPart] = stream.split("@");

            // btcusdt_perpetual => btcusdt, perpetual
            const [rawSymbol, parsedContractType] = symbolPart.split("_");

            // continuousKline_1m => continuousKline, 1m
            const [parsedStreamType, parsedInterval] = streamPart.split("_");

            return {
              symbol: rawSymbol.toUpperCase(),
              contractType: parsedContractType,
              streamType: parsedStreamType,
              interval: parsedInterval,
            };
          });

          symbols = [...new Set(parsedStreams.map((item) => item.symbol))];
          streamTypes = [
            ...new Set(parsedStreams.map((item) => item.streamType)),
          ];

          contractType = parsedStreams.find(
            (item) => item.contractType,
          )?.contractType;
          interval = parsedStreams.find((item) => item.interval)?.interval;
        }

        if (isOrderUpdate) {
          const tradingSource = `${source}_trading`;
          await SubscriptionService.unsubscribe({
            source: tradingSource,
            userId,
            workflowId,
            symbols: ["*"],
            streamType: streams,
            ...(source === "binance" && {
              marketType: streams.some((s) => s === "executionReport")
                ? "spot"
                : "futures",
            }),
            environment,
            scope: "workflow",
            targetWorkflowId: workflowId,
          });
        } else {
          await SubscriptionService.unsubscribe({
            source: sourceId,
            userId,
            workflowId,
            symbols: symbols,
            streamType: streamTypes,
            environment,
            assetType: undefined,
            marketType: undefined,
            contractType,
            interval,
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

    await OrderOwnerRegistry.cleanupByWorkflow(workflowId);

    await this.cleanupWorkflowListeners(userId, workflowId);

    if (!options?.skipSubscriptionCleanup) {
      await this.cleanupWorkflowSubscriptions(userId, workflowId);
    }

    if (!sessionDataCleared) {
      await this.clearSessionData(userId, workflowId);
    }
  }
}
