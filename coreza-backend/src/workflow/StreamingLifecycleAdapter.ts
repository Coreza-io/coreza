import { FillSyncWorker } from "../workers/FillSyncWorker";
import { getRedisCache } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import { createError } from "../middleware/errorHandler";
import { getSourceMapping, MarketSource } from "../brokers";
import {
  getTradingStreamsForSource,
  isTradingSource as checkIsTradingSource,
  BROKER_CAPABILITIES,
} from "../brokers/capabilities";
import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { RegistrationService } from "../services/RegistrationService";
import { bullMqJobQueue as jobQueue } from "../infra/jobQueue/jobQueueManager";
import { SubscriptionService } from "../services/SubscriptionService";
import { parseSymbols, resolveStreamSourceId } from "./subscriptionPolicy";
import { classifyTrigger, findStreamingDataNodes } from "./triggerClassifier";
import { RedisKeys } from "../infra/redisKeys";
import { buildCryptoSymbols, validateAlpacaCryptoSymbols } from "../utils/symbolHelpers";
import logger from "../utils/logger";
import { MAX_LISTENERS_PER_USER } from "../config/streaming";
import { OrderOwnerRegistry } from "../services/OrderOwnerRegistry";

const ORDER_UPDATE_MARKERS = new Set([
  "trade_updates",
  "ORDER_TRADE_UPDATE",
  "ALGO_UPDATE",
  "executionReport",
  "account_activity",
  "order_alert",
]);

const NEWS_MARKERS = new Set(["news"]);

function normalizeStreamTypeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((streamType) => String(streamType).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((streamType) => streamType.trim())
      .filter(Boolean);
  }
  return [];
}

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
  return getTradingStreamsForSource(source, marketType);
}

function isTradingSource(source: string): boolean {
  return checkIsTradingSource(source);
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
    // Reporting writes and operational fill streams outlive the runner. Never
    // destroy an old activation's snapshots or unconsumed fills during handoff.
    await FillSyncWorker.flushWorkflow(userId, workflowId);
    await redis.del(RedisKeys.strategyStream(userId, workflowId));
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
    await this.clearSessionData(userId, workflowId);
    const redis = getRedisCache();
    const nodeValues = ((
      triggerNode as WorkflowNode & {
        values?: {
          scope?: string;
          onlyClosedBars?: boolean;
          symbols?: unknown;
          stream_type?: string[] | string;
          stream_types?: string[] | string;
          credential_id?: string;
          exchange?: string;
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
      mode: string;
      scope?: string;
      onlyClosedBars?: boolean;
      symbols?: unknown;
      stream_type?: string[] | string;
      stream_types?: string[] | string;
      credential_id?: string;
      exchange?: string;
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

    const sourceId = resolveStreamSourceId(triggerNode);
    if (!sourceId) {
      throw createError("Unknown streaming source", 400);
    }

    // --- Resolve symbols (standard + crypto fallback) ---
    let symbols = parseSymbols(nodeValues.symbols);
    if (sourceId.split("_")[0] === "alpaca" && nodeValues.assetType === "crypto") {
      symbols = validateAlpacaCryptoSymbols(nodeValues.crypto_base ?? nodeValues.symbols);
    } else if (symbols.length === 0 && nodeValues.assetType === "crypto") {
      symbols = buildCryptoSymbols(
        nodeValues.assetType,
        nodeValues.crypto_base,
        nodeValues.crypto_quote,
      );
    }

    const streamType = normalizeStreamTypeList(
      nodeValues.stream_type ?? nodeValues.stream_types,
    );
    // Split trading lifecycle marker from market stream types
    const hasOrderUpdate = streamType.some((streamName) =>
      ORDER_UPDATE_MARKERS.has(streamName),
    );
    const hasNews = streamType.some((streamName) =>
      NEWS_MARKERS.has(streamName),
    );

    const { marketstreamType, tradingstreamType, newsStreamType } =
      streamType.reduce(
        (acc, t: string) => {
          if (ORDER_UPDATE_MARKERS.has(t)) {
            acc.tradingstreamType.push(t);
          } else if (NEWS_MARKERS.has(t)) {
            acc.newsStreamType.push(t);
          } else {
            acc.marketstreamType.push(t);
          }
          return acc;
        },
        {
          marketstreamType: [] as string[],
          tradingstreamType: [] as string[],
          newsStreamType: [] as string[],
        },
      );

    const environment = nodeValues.environment as string;
    const subscriptionScope: "workflow" | "global" =
      nodeValues.scope === "global" ? "global" : "workflow";

    const subscribeReady = async (params: Parameters<typeof SubscriptionService.subscribe>[0]) => {
      const result = await SubscriptionService.subscribe(params);
      if (!result.success) throw new Error(result.error || "Stream subscription failed");
      return result;
    };

    if (nodeValues.mode !== "listen") {
      // --- Subscribe FIRST, then wait for readiness, then register ---

      // 1. Subscribe to trading source for order updates
      if (hasOrderUpdate) {
        const baseName = triggerNode.subCategory;
        const tradingSourceId = `${baseName}_trading`;
        await subscribeReady({
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
          contractType: nodeValues.contractType as
            | "perpetual"
            | "current_quarter"
            | "next_quarter"
            | undefined,
          scope: subscriptionScope,
          targetWorkflowId: workflowId,
        });
      }

      // 1b. Subscribe to dedicated news source when selected
      if (hasNews) {
        const baseName = triggerNode.subCategory;
        const newsSourceId = `${baseName}_news`;
        await subscribeReady({
          source: newsSourceId,
          userId,
          workflowId,
          nodeId: triggerNode.id,
          credentialId: nodeValues.credential_id || "",
          symbols,
          streamType: newsStreamType.length > 0 ? newsStreamType : ["news"],
          feed: nodeValues.feed,
          environment,
          assetType: nodeValues.assetType,
          marketType: nodeValues.marketType,
          contractType: nodeValues.contractType as
            | "perpetual"
            | "current_quarter"
            | "next_quarter"
            | undefined,
          scope: subscriptionScope,
          targetWorkflowId: workflowId,
        });
      }

      // 2. Subscribe to market/crypto streams
      if (
        symbols.length > 0 &&
        (marketstreamType.length > 0 || (!hasOrderUpdate && !hasNews))
      ) {
        const marketSubscribeParams = {
          source: sourceId,
          userId,
          workflowId,
          nodeId: triggerNode.id,
          credentialId: nodeValues.credential_id || "",
          symbols,
          streamType: marketstreamType.length > 0 ? marketstreamType : undefined,
          exchange: nodeValues.exchange,
          feed: nodeValues.feed,
          environment,
          assetType: nodeValues.assetType,
          marketType: nodeValues.marketType,
          contractType: nodeValues.contractType as
            | "perpetual"
            | "current_quarter"
            | "next_quarter"
            | undefined,
          interval: nodeValues.interval,
          depth_levels:
            nodeValues.depth_levels !== undefined
              ? String(nodeValues.depth_levels)
              : undefined,
          scope: subscriptionScope,
          targetWorkflowId: workflowId,
        };

        await subscribeReady(marketSubscribeParams);
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

    let listenerKey: string | undefined;
    try {
      // Create listener
      listenerKey = await RegistrationService.createListener({
        userId,
        workflowId,
        nodeId: triggerNode.id,
        source: sourceId,
        mode: nodeValues.mode,
        scope: nodeValues.scope || "workflow",
        environment,
        symbols: symbols,
        streamTypes: streamType,
        assetType: nodeValues.assetType,
        marketType: nodeValues.marketType,
        contractType: nodeValues.contractType as
          | "perpetual"
          | "current_quarter"
          | "next_quarter"
          | undefined,
        interval: nodeValues.interval,
        depth_levels:
          nodeValues.depth_levels !== undefined
            ? String(nodeValues.depth_levels)
            : undefined,
      });

      // 3. NOW register the workflow (subscriptions are materialized)
      await RegistrationService.publishRegisterWorkflow({
        readinessChecks: [
          ...(marketstreamType.length ? [{ source: sourceId, symbols, streamType: marketstreamType,
            credentialId: nodeValues.credential_id, feed: nodeValues.feed, marketType: nodeValues.marketType,
            exchange: nodeValues.exchange, interval: nodeValues.interval, contractType: nodeValues.contractType }] : []),
          ...(hasOrderUpdate ? [{ source: `${triggerNode.subCategory}_trading`, symbols: ["*"],
            streamType: tradingstreamType, credentialId: nodeValues.credential_id, marketType: nodeValues.marketType }] : []),
          ...(hasNews ? [{ source: `${triggerNode.subCategory}_news`, symbols, streamType: newsStreamType,
            credentialId: nodeValues.credential_id, feed: nodeValues.feed, marketType: nodeValues.marketType }] : []),
        ],
        userId,
        workflowId,
        nodeId: triggerNode.id,
        source: sourceId,
        scope: subscriptionScope,
        environment,
        onlyClosedBars: nodeValues.onlyClosedBars ?? true,
        interval: nodeValues.interval,
        isLive: true,
        symbols: symbols,
        streamTypes: streamType,
      });
    } catch (error) {
      try {
        if (listenerKey) await RegistrationService.deleteListener(userId, workflowId, triggerNode.id);
        else await RegistrationService.decrementListenerCount(userId);
      } catch {
        logger.warn({ workflowId }, "Failed to release listener reservation after startup failure");
      }
      throw error;
    }

    await redis.sadd(
      REDIS_CHANNELS.activeStreamingWorkflows(userId),
      workflowId,
    );

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
    await jobQueue.stopWorkflowRunner(workflowId);
    await FillSyncWorker.flushWorkflow(userId, workflowId);
    // Keep scoped order owners until their existing TTL so late fills retain identity.
    await this.cleanupWorkflowListeners(userId, workflowId);
    await RegistrationService.publishUnregisterWorkflow({
      userId,
      workflowId,
      isTestListener: false,
    });


  }

  async unsubscribeStreamingNodes(
    userId: string,
    workflowId: string,
    nodes: WorkflowNode[],
  ): Promise<void> {
    const streamingNodes = findStreamingDataNodes(nodes);

    for (const node of streamingNodes) {
      const nodeValues = node.values || node.data?.values || {};
      const sourceId = toMarketSource(resolveStreamSourceId(node));

      if (!sourceId) {
        continue;
      }
      const symbolArray = sourceId.split("_")[0] === "alpaca" && nodeValues.assetType === "crypto"
        ? validateAlpacaCryptoSymbols(nodeValues.crypto_base ?? nodeValues.symbols)
        : parseSymbols(nodeValues.symbols);

      const streamTypes = normalizeStreamTypeList(
        nodeValues.stream_type ?? nodeValues.stream_types,
      );
      // If order_update is included, also unsubscribe from trading source
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
          exchange: nodeValues.exchange as string,
          feed: nodeValues.feed as string,
          environment: nodeValues.environment as string,
          assetType: nodeValues.assetType as string,
          marketType: nodeValues.marketType as string,
          contractType: nodeValues.contractType as
            | "perpetual"
            | "current_quarter"
            | "next_quarter"
            | undefined,
          interval: nodeValues.interval as string,
          depth_levels:
            nodeValues.depth_levels !== undefined
              ? String(nodeValues.depth_levels)
              : undefined,
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
    const pattern = `sub:userId:${userId}:scope:workflow:workflowId:${workflowId}:*:streams`;

    // Key structure: sub:userId:{userId}:scope:workflow:workflowId:{workflowId}:{source}:{environment}:streams
    //                 0   1      2        3        4          5        6        7          8
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
            // Config-driven: if broker has spot trading streams, determine market type
            ...(BROKER_CAPABILITIES[source]?.streaming.spotTradingStreams && {
              marketType: streams.some((s) =>
                BROKER_CAPABILITIES[
                  source
                ]?.streaming.spotTradingStreams?.includes(s),
              )
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
            contractType: contractType as
              | "perpetual"
              | "current_quarter"
              | "next_quarter"
              | undefined,
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
