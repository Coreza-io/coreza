import Redis from "ioredis";
import { LOG } from "../utils/logging";
import { LIVE_TIMING_ENABLED, timingNow, observeStage, observeIngress, countLive, changeIngressQueueDepth, liveEventKind } from "../utils/liveTiming";
import { createRedisPubSub, getRedisCache } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import {
  CorezaMarketEvent,
  MarketSource,
  MarketEventType,
} from "../types/marketEvent";
import WorkflowCache from "./WorkflowCache";
import {
  redisPublishBreaker,
  redisSetBreaker,
} from "../utils/redisCircuitBreaker";
import logger from "../utils/logger";
import { getSourceMapping } from "../marketGateways";
import { RedisKeys } from "../infra/redisKeys";
import { normalizeOrderSymbol } from "../utils/symbolNormalize";
import { tradingRoutingKey } from "../utils/streamName";
import {
  computeTradingNativeStreamsFromConfig,
  getBrokerStreamConfig,
  resolveTradingPublishStreamName,
} from "../config/brokerStreamConfig";
import { OrderOwnerRegistry } from "./OrderOwnerRegistry";
import { TickBarAggregator } from "./TickBarAggregator";

const ORDER_UPDATE_DELAY_MS = 5000; // ms between order lifecycle events
const TRADING_LIFECYCLE_EVENT_TYPES = new Set([
  "algo_update",
  "trade_updates",
  "ORDER_TRADE_UPDATE",
  "executionReport",
  "order_update",
  "order_alert",
  "account_activity",
  "listen_key_expired",
]);
const ORDER_OWNER_PREFIX = "orderowner";
const AGGREGATION_SWEEP_MS = 1000;

function computeTradingNativeStreams(
  source: string,
  marketType?: string,
): string[] {
  return computeTradingNativeStreamsFromConfig(source, marketType);
}

/**
 * Workflow registration metadata for receiving market data
 * This is NOT a broker subscription - it registers a workflow to receive data
 * from already-subscribed market data channels
 */
interface WorkflowRegistration {
  workflowId: string;
  nodeId: string;
  userId: string;
  streams: Set<string>;
  tradingNativeStreams: Set<string>;
  source: MarketSource;
  environment: string;
  allowedSymbols: Set<string>;
  symbolMatchMode: "exact" | "wildcard";
  onlyClosedBars?: boolean; // Filter out unclosed Binance klines (default: true)
  interval?: string;
  isLive: boolean; // true = append to strategy stream for WorkflowRunner; false = frontend-only (manual test)
}

interface PersistedRegistration {
  workflowId: string;
  nodeId: string;
  userId: string;
  streams: string[];
  source: MarketSource;
  environment: string;
  onlyClosedBars?: boolean;
  interval?: string;
  isLive?: boolean;
  filterSymbols?: string[];
  symbolMatchMode?: "exact" | "wildcard";
  tradingNativeStreams?: string[];
  marketType?: string;
}

export class MarketDataSubscriber {
  private static instance: MarketDataSubscriber;

  // workflowId → registration metadata
  private registrations = new Map<string, WorkflowRegistration>();

  // stream → Set<workflowId> for fast lookup
  private streamWorkflows = new Map<string, Set<string>>();

  private redisSub: Redis | null = null;
  private redisPub: Redis | null = null;
  private isInitialized = false;
  private messageHandler:
    | ((channel: string, message: string) => Promise<void>)
    | null = null;
  private registrationChanges = new Map<string, Promise<void>>();
  private deliveryQueues = new Map<string, Promise<void>>();
  private tickAggregator = new TickBarAggregator();
  private aggregationSweep: NodeJS.Timeout | null = null;

  private constructor() {
    // Lazy initialization - don't create Redis connections here
  }

  private ensureRedisConnections(): { pub: Redis; sub: Redis } {
    if (!this.redisSub || !this.redisPub) {
      const { pub, sub } = createRedisPubSub();
      // Order-owner keys are shared via queue Redis: backend writes, subscriber resolves via OrderOwnerRegistry/getRedisQueue.
      this.redisSub = sub;
      this.redisPub = pub;
    }
    return { pub: this.redisPub, sub: this.redisSub };
  }

  private getWorkflowCache(): WorkflowCache {
    return WorkflowCache.getInstance();
  }

  // Serialize lifecycle I/O only; market-event delivery never takes this lock.
  private async lockRegistration(workflowId: string): Promise<() => void> {
    const previous = this.registrationChanges.get(workflowId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.registrationChanges.set(workflowId, current);
    await previous;
    return () => {
      if (this.registrationChanges.get(workflowId) === current) {
        this.registrationChanges.delete(workflowId);
      }
      release();
    };
  }

  static getInstance(): MarketDataSubscriber {
    if (!MarketDataSubscriber.instance) {
      MarketDataSubscriber.instance = new MarketDataSubscriber();
    }
    return MarketDataSubscriber.instance;
  }

  /**
   * Register a workflow to receive market data streams
   * This does NOT subscribe to a broker - it registers the workflow to receive
   * data from already-subscribed Redis channels
   */
  async registerWorkflow(
    workflowId: string,
    nodeId: string,
    userId: string,
    streams: string[],
    source: MarketSource | string,
    environment: string,
    onlyClosedBars?: boolean,
    isLive?: boolean,
    filterSymbols: string[] = [],
    symbolMatchMode: "exact" | "wildcard" = "exact",
    tradingNativeStreams: string[] = [],
    interval?: string,
    requireActive = false,
    startupDeadline?: number,
    startupReady?: () => boolean,
  ): Promise<void> {
    const release = await this.lockRegistration(workflowId);
    const previous = this.registrations.get(workflowId);
    let acquired = false;
    let installed: WorkflowRegistration | undefined;
    const assertCurrent = () => {
      if (Date.now() >= (startupDeadline ?? Infinity)) throw new Error("Listener startup timed out. Please retry.");
      if (startupReady && !startupReady()) throw new Error("Gateway disconnected during listener startup. Subscribe again.");
    };
    try {
      assertCurrent();
      console.log(
        `📊 [MarketDataSubscriber] Registering workflow ${workflowId} for streams (isLive: ${isLive ?? false}):`,
        streams,
      );

      if (!String(source || "").trim()) {
        throw new Error("registerWorkflow requires non-empty source");
      }

      if (isLive) {
        // Validate once per registration, outside event delivery. Activation
        // publishes registration before committing is_active, so check existence
        // and ownership here; restart recovery requires is_active as well.
        const cache = this.getWorkflowCache();
        cache.invalidate(workflowId);
        const workflow = await cache.getWorkflow(workflowId);
        if (!workflow || workflow.user_id !== userId || (requireActive && !workflow.is_active)) {
          throw new Error("Live workflow unavailable for registering user");
        }
      }

      const normalizedSymbols = filterSymbols.map((symbol) =>
        normalizeOrderSymbol(symbol, String(source).split("_")[0]),
      );
      const nativeTradingStreams = tradingNativeStreams.map((s) => String(s));
      const allStreams = [...streams.map((s) => s), ...nativeTradingStreams];

      // Create registration object
      const registration: WorkflowRegistration = {
        workflowId,
        nodeId,
        userId,
        streams: new Set(allStreams),
        tradingNativeStreams: new Set(nativeTradingStreams),
        source,
        environment,
        allowedSymbols: new Set(normalizedSymbols),
        symbolMatchMode,
        onlyClosedBars: onlyClosedBars ?? true, // Default to true (only closed bars for Binance)
        interval,
        isLive: isLive ?? false,
      };

      // Replace routing and aggregation state along with the registration.
      if (startupDeadline === undefined && this.registrations.has(workflowId)) {
        await this.unregisterWorkflowLocked(userId, workflowId);
      }

      // Store in memory
      this.registrations.set(workflowId, registration);
      acquired = true;
      installed = registration;

      // Update stream→workflow mapping
      for (const stream of this.getRedisSubscriptionStreams(registration)) {
        if (!this.streamWorkflows.has(stream)) {
          this.streamWorkflows.set(stream, new Set());

          // Subscribe to Redis channel for this stream
          const channel = REDIS_CHANNELS.streamData(stream);
          const { sub } = this.ensureRedisConnections();
          await sub.subscribe(channel);
          assertCurrent();
          console.log(
            `📊 [MarketDataSubscriber] Subscribed to Redis channel: ${channel}`,
          );
          console.log(
            `🟢 [DEBUG-2] Current subscribed channels:`,
            this.streamWorkflows.keys(),
          );
        }
        this.streamWorkflows.get(stream)!.add(workflowId);
      }

      // Persist to Redis
      await this.persistRegistration(registration);
      assertCurrent();

      // A confirmed startup must stop routing streams outside the new selection.
      if (previous && startupDeadline !== undefined) {
        const selected = new Set(this.getRedisSubscriptionStreams(registration));
        for (const stream of this.getRedisSubscriptionStreams(previous)) {
          if (selected.has(stream)) continue;
          const workflows = this.streamWorkflows.get(stream);
          workflows?.delete(workflowId);
          if (workflows?.size === 0) {
            await this.ensureRedisConnections().sub.unsubscribe(REDIS_CHANNELS.streamData(stream));
            this.streamWorkflows.delete(stream);
          }
          assertCurrent();
        }
      }

      if (previous && startupDeadline !== undefined) this.tickAggregator.dispose(workflowId);

      // Initialize message handler if not already done
      if (!this.isInitialized) {
        this.setupMessageHandler();
        this.startAggregationSweep();
        this.isInitialized = true;
      }

      console.log(
        `✅ [MarketDataSubscriber] Workflow ${workflowId} registered successfully`,
      );
    } catch (error) {
      if (startupDeadline !== undefined && acquired && this.registrations.get(workflowId) === installed) {
        // Restore only this attempt's routing changes, retaining prior aggregation state.
        const current = this.registrations.get(workflowId)!;
        const priorStreams = new Set(previous ? this.getRedisSubscriptionStreams(previous) : []);
        if (previous) this.registrations.set(workflowId, previous);
        else this.registrations.delete(workflowId);
        for (const stream of this.getRedisSubscriptionStreams(current)) {
          if (priorStreams.has(stream)) continue;
          const workflows = this.streamWorkflows.get(stream);
          workflows?.delete(workflowId);
          if (workflows?.size === 0) {
            await this.ensureRedisConnections().sub.unsubscribe(REDIS_CHANNELS.streamData(stream));
            this.streamWorkflows.delete(stream);
          }
        }
        if (previous) {
          // A failure while removing obsolete channels must also restore those channels.
          for (const stream of priorStreams) {
            if (!this.streamWorkflows.has(stream)) {
              this.streamWorkflows.set(stream, new Set());
              await this.ensureRedisConnections().sub.subscribe(REDIS_CHANNELS.streamData(stream));
            }
            this.streamWorkflows.get(stream)!.add(workflowId);
          }
          await this.persistRegistration(previous);
        } else {
          await this.ensureRedisConnections().pub.del(REDIS_CHANNELS.workflowRegistration(userId, workflowId));
        }
      }
      if (startupDeadline === undefined && installed && this.registrations.get(workflowId) === installed) {
        try {
          await this.unregisterWorkflowLocked(userId, workflowId);
        } catch (cleanupError) {
          logger.error({ err: cleanupError, workflowId }, "Failed registration cleanup");
        }
      }
      console.error(`❌ [MarketDataSubscriber] Register error:`, error);
      throw error;
    } finally {
      release();
    }
  }

  /**
   * Unregister a workflow from receiving market data streams
   * This does NOT unsubscribe from a broker - it removes the workflow from
   * the internal routing table
   */
  async unregisterWorkflow(userId: string, workflowId: string): Promise<void> {
    const release = await this.lockRegistration(workflowId);
    try {
      await this.unregisterWorkflowLocked(userId, workflowId);
    } finally {
      release();
    }
  }

  private async unregisterWorkflowLocked(userId: string, workflowId: string): Promise<void> {
    try {
      console.log(
        `📊 [MarketDataSubscriber] Unregistering workflow ${workflowId}`,
      );

      const registration = this.registrations.get(workflowId);
      if (!registration) {
        console.warn(
          `⚠️  [MarketDataSubscriber] No registration found for workflow ${workflowId}`,
        );
        const { pub } = this.ensureRedisConnections();
        await pub.del(REDIS_CHANNELS.workflowRegistration(userId, workflowId));
        return;
      }

      // Retire the registration before awaiting I/O so queued deliveries stop.
      this.registrations.delete(workflowId);
      this.tickAggregator.dispose(workflowId);

      // Remove from stream→workflow mapping
      for (const stream of this.getRedisSubscriptionStreams(registration)) {
        const workflows = this.streamWorkflows.get(stream);
        if (workflows) {
          workflows.delete(workflowId);

          // If no more workflows need this stream, unsubscribe from Redis channel
          if (workflows.size === 0) {
            const channel = REDIS_CHANNELS.streamData(stream);
            const { sub } = this.ensureRedisConnections();
            await sub.unsubscribe(channel);
            this.streamWorkflows.delete(stream);
            console.log(
              `📊 [MarketDataSubscriber] Unsubscribed from Redis channel: ${channel}`,
            );
          }
        }
      }

      // Remove from Redis persistence
      const { pub } = this.ensureRedisConnections();
      await pub.del(REDIS_CHANNELS.workflowRegistration(userId, workflowId));

      console.log(
        `✅ [MarketDataSubscriber] Workflow ${workflowId} unregistered successfully`,
      );
    } catch (error) {
      console.error(`❌ [MarketDataSubscriber] Unregister error:`, error);
      throw error;
    }
  }

  /**
   * Restore workflow registrations from Redis on startup
   */
  async restoreFromRedis(): Promise<void> {
    try {
      console.log(
        `📊 [MarketDataSubscriber] Restoring registrations from Redis...`,
      );

      const { pub } = this.ensureRedisConnections();
      await this.cleanupLegacyTradingStreamEntries(pub);
      // Use user-scoped pattern: workflow:userId:{userId}:workflowId:{workflowId}
      const pattern = "workflow:userId:*:workflowId:*";
      const keys = await pub.keys(pattern);

      let restored = 0;
      for (const key of keys) {
        try {
          const data = await pub.get(key);
          if (!data) continue;

          const registration = JSON.parse(data) as PersistedRegistration;
          const inferredTradingNativeStreams = computeTradingNativeStreams(
            String(registration.source),
            registration.marketType ||
              ((registration.streams || []).includes("executionReport")
                ? "spot"
                : undefined),
          );

          const streams = Array.from(
            new Set(
              (registration.streams || [])
                .filter((stream) => !String(stream).endsWith("@order_update"))
                .concat(inferredTradingNativeStreams),
            ),
          );
          const cleanedTradingNativeStreams = Array.from(
            new Set(
              (registration.tradingNativeStreams || []).concat(
                inferredTradingNativeStreams,
              ),
            ),
          );

          if (registration.isLive) {
            // Only live workflows require a persisted active definition.
            const workflow = await this.getWorkflowCache().getWorkflow(
              registration.workflowId,
            );

            if (!workflow?.is_active) {
              console.log(
                `⚠️  Skipping inactive live workflow ${registration.workflowId}`,
              );
              await pub.del(key);
              continue;
            }
          }

          // Restore registration (only restore live registrations on restart)
          await this.registerWorkflow(
            registration.workflowId,
            registration.nodeId,
            registration.userId,
            streams,
            registration.source,
            registration.environment,
            registration.onlyClosedBars,
            registration.isLive,
            registration.filterSymbols || [],
            registration.symbolMatchMode || "exact",
            cleanedTradingNativeStreams,
            registration.interval,
            true,
          );

          restored++;
        } catch (err) {
          console.error(`Failed to restore registration from key ${key}:`, err);
        }
      }

      console.log(
        `✅ [MarketDataSubscriber] Restored ${restored} registrations from Redis`,
      );
    } catch (error) {
      console.error(`❌ [MarketDataSubscriber] Restore error:`, error);
    }
  }

  private async cleanupLegacyTradingStreamEntries(pub: Redis): Promise<void> {
    const patterns = [
      "sub:userId:*:scope:workflow:workflowId:*:*:*:streams",
      "sub:userId:*:scope:global:*:*:streams",
    ];

    for (const pattern of patterns) {
      const keys = await pub.keys(pattern);
      for (const key of keys) {
        const entries = await pub.smembers(key);
        const legacyEntries = entries.filter((entry) =>
          entry.endsWith("@order_update"),
        );
        if (legacyEntries.length === 0) {
          continue;
        }

        await pub.srem(key, ...legacyEntries);

        const segments = key.split(":");
        const source = segments[segments.length - 3];
        const nativeTradingStreams = computeTradingNativeStreams(
          source,
          entries.includes("executionReport") ? "spot" : undefined,
        );
        if (nativeTradingStreams.length > 0) {
          await pub.sadd(key, ...nativeTradingStreams);
        }
      }
    }
  }

  private getRedisSubscriptionStreams(
    registration: WorkflowRegistration,
  ): string[] {
    const streams = new Set(registration.streams);
    if (registration.interval && registration.onlyClosedBars !== false) {
      const cfg = getBrokerStreamConfig(registration.source);
      for (const stream of registration.streams) {
        const rawStream = this.stripAggregationInterval(
          stream,
          registration.interval,
        );
        const streamType = this.extractStreamType(rawStream);
        if (streamType && cfg.aggregatableTickTypes?.includes(streamType)) {
          streams.add(rawStream);
        }
      }
    }
    return Array.from(streams);
  }

  private stripAggregationInterval(stream: string, interval: string): string {
    return stream.endsWith(`_${interval}`)
      ? stream.slice(0, -1 * `_${interval}`.length)
      : stream;
  }

  private toIntervalStream(stream: string, interval: string): string {
    return stream.endsWith(`_${interval}`) ? stream : `${stream}_${interval}`;
  }

  private extractStreamType(stream: string): string | undefined {
    const lastSegment = stream.split("@").pop();
    return lastSegment?.split("_")[0];
  }

  private startAggregationSweep(): void {
    if (this.aggregationSweep) return;
    this.aggregationSweep = setInterval(() => {
      for (const closed of this.tickAggregator.flushDue(Date.now())) {
        const registration = this.registrations.get(closed.workflowId);
        if (!registration) continue;
        this.enqueueWorkflowDelivery(
          closed.workflowId,
          registration,
          closed.event,
        );
      }
    }, AGGREGATION_SWEEP_MS);
  }

  /**
   * Setup Redis message handler with memory leak prevention
   */
  private setupMessageHandler(): void {
    const { sub } = this.ensureRedisConnections();

    // Remove existing handler to prevent duplicates
    if (this.messageHandler) {
      sub.off("message", this.messageHandler);
    }

    // Create new handler
    this.messageHandler = async (channel: string, message: string) => {
      try {
        // Parse market event
        const event: CorezaMarketEvent = JSON.parse(message);

        // Validate that this is a proper market event, not a Redis control message
        if (!event || typeof event !== "object" || !event.type) {
          // Not a valid CorezaMarketEvent, skip (could be subscription confirmation)
          return;
        }

        // News fan-out events should already have a symbol set by the gateway.
        // Fallback to channel-derived stream only if symbol is absent for safety.
        if (!event.symbol && event.type !== "news") return;

        const isTradingLifecycleEvent =
          typeof event.type === "string" &&
          TRADING_LIFECYCLE_EVENT_TYPES.has(event.type);

        if (isTradingLifecycleEvent) {
          await this.routeTradingLifecycleEvent(event);
          return;
        }

        // const streamPrefix = REDIS_CHANNELS.streamData("");
        // const fallbackStream = channel.startsWith(streamPrefix)
        //   ? channel.slice(streamPrefix.length)
        //   : channel;
        // const stream = event.symbol
        //   ? event.timeframe
        //     ? event.contractType
        //       ? `${event.symbol.toLowerCase()}_${event.contractType.toLowerCase()}@${event.type}_${event.timeframe}`
        //       : `${event.symbol.toLowerCase()}@${event.type}_${event.timeframe}`
        //     : event.contractType
        //       ? `${event.symbol.toLowerCase()}_${event.contractType.toLowerCase()}@${event.type}`
        //       : `${event.symbol.toLowerCase()}@${event.type}`
        //   : fallbackStream;
        const exchangePart = event.exchange
          ? `@${event.exchange.toLowerCase()}`
          : "";
        const stream = isTradingLifecycleEvent
          ? resolveTradingPublishStreamName(event.source, event.type)
          : event.timeframe
            ? event.contractType
              ? `${event.symbol.toLowerCase()}_${event.contractType.toLowerCase()}@${event.type}_${event.timeframe}`
              : `${event.symbol.toLowerCase()}${exchangePart}@${event.type}_${event.timeframe}`
            : event.contractType
              ? `${event.symbol.toLowerCase()}_${event.contractType.toLowerCase()}@${event.type}`
              : `${event.symbol.toLowerCase()}${exchangePart}@${event.type}`;

        // Find workflows registered for this stream
        const workflows = this.streamWorkflows.get(stream);

        const allWorkflows = new Set([...(workflows || [])]);

        if (allWorkflows.size === 0) return;

        if (LOG) logger.debug(
          {
            stream: stream,
            workflowCount: allWorkflows.size,
          },
          "Received market event",
        );

        // Trigger each registered workflow
        for (const workflowId of allWorkflows) {
          const registration = this.registrations.get(workflowId);
          if (!registration) continue;

          // Filter by source if specified
          const regBroker = String(registration.source ?? "")
            .split("_")[0]
            .toLowerCase();
          const evtBroker = String(event.source ?? "")
            .split("_")[0]
            .toLowerCase();
          if (!regBroker || !evtBroker || regBroker !== evtBroker) {
            logger.warn(
              {
                workflowId,
                stream,
                registrationSource: registration.source,
                eventSource: event.source,
              },
              "Skipping market event due to broker mismatch",
            );
            continue;
          }

          const cfg = getBrokerStreamConfig(event.source);
          const shouldAggregate =
            registration.onlyClosedBars !== false &&
            Boolean(registration.interval) &&
            cfg.aggregatableTickTypes?.includes(event.type) === true;

          if (shouldAggregate) {
            const deliveryStream = registration.interval
              ? this.toIntervalStream(stream, registration.interval)
              : stream;
            const bar = this.tickAggregator.push(
              workflowId,
              deliveryStream,
              event,
            );
            if (bar)
              this.enqueueWorkflowDelivery(workflowId, registration, bar);
            continue;
          }

          // Filter unclosed bars for Binance when onlyClosedBars is enabled
          // Binance klines stream continuously with isClosed=false until the candle closes
          // Other sources (Alpaca) only emit bars when closed, so no filter needed
          if (
            registration.onlyClosedBars !== false && // Default is true
            getBrokerStreamConfig(event.source).emitsUnclosedBars &&
            (event.type === "kline" || event.type === "continuousKline") &&
            event.isClosed !== true
          ) {
            if (LOG) logger.debug(
              {
                symbol: event.symbol,
                type: event.type,
                isClosed: event.isClosed,
                workflowId: registration.workflowId,
              },
              "Skipping unclosed Binance bar (onlyClosedBars enabled)",
            );
            continue;
          }

          this.enqueueWorkflowDelivery(workflowId, registration, event);
        }
      } catch (error) {
        console.error(
          `❌ [MarketDataSubscriber] Message handler error:`,
          error,
        );
      }
    };

    // Attach handler
    sub.on("message", this.messageHandler);
    console.log(`✅ [MarketDataSubscriber] Message handler setup complete`);

    console.log(`🟡 [SUBSCRIBER] Handler attached to redisSub`);
    console.log(`🟡 [SUBSCRIBER] redisSub.status: ${sub.status}`);
  }

  private async findTradingEventOwner(
    event: CorezaMarketEvent,
  ): Promise<any | null> {
    return OrderOwnerRegistry.findOwner(
      `${event.source}_trading`,
      OrderOwnerRegistry.deriveCandidateIds(event),
    );
  }

  private broadcastAccountEvent(event: CorezaMarketEvent): void {
    for (const [workflowId, registration] of this.registrations.entries()) {
      const regBroker = String(registration.source || "").split("_")[0];
      if (regBroker === event.source) {
        this.enqueueWorkflowDelivery(workflowId, registration, event);
      }
    }
  }

  private async routeTradingLifecycleEvent(
    event: CorezaMarketEvent,
  ): Promise<void> {
    if (event.type === "listen_key_expired") {
      this.broadcastAccountEvent(event);
      return;
    }

    let owner: any | null = null;
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 200;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      owner = await this.findTradingEventOwner(event);
      if (owner?.workflowId) break;
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    if (!owner?.workflowId) {
      logger.warn(
        {
          eventType: event.type,
          source: event.source,
          orderId: event.orderId,
          clientOrderId: event.clientOrderId,
          orderEvent: event.orderEvent,
        },
        "No owner mapping found after retries; falling back to account-level broadcast",
      );
      this.broadcastAccountEvent(event);
      return;
    }
    const registration = this.registrations.get(owner.workflowId);
    if (!registration) return;
    this.enqueueWorkflowDelivery(owner.workflowId, registration, event);
  }

  /**
   * Format CorezaMarketEvent to REST-like structure
   * Used for both frontend WebSocket and backend workflow execution
   */
  private formatMarketEventPayload(event: CorezaMarketEvent): {
    data: Record<string, any>;
  } {
    const { symbol, type, source, _timing, ...cleanEventData } = event;

    const typeKeyMap: Record<string, string> = {
      bar: "bar",
      daily_bar: "bar",
      trade: "trade",
      quote: "quote",
      ticker: "ticker",
      news: "news",
    };
    const dataKey = typeKeyMap[type] || type;

    if (
      type === "kline" ||
      type === "bar" ||
      type === "daily_bar" ||
      type === "continuousKline"
    ) {
      return {
        data: {
          type,
          _seq: event._seq,
          _orderingDomain: event._orderingDomain,
          BarSeries: [
            {
              symbol,
              interval:
                type === "bar"
                  ? "1Min"
                  : type === "daily_bar"
                    ? "1Day"
                    : event.timeframe,
              bars: [
                {
                  time:
                    typeof event.t === "number"
                      ? event.t
                      : Date.parse(String(event.t)),
                  open: event.o,
                  high: event.h,
                  low: event.l,
                  close: event.c,
                  volume: event.v,
                  vwap: event.vw,
                },
              ],
              ...(event.contractType && { contractType: event.contractType }),
              ...(event.isClosed !== undefined && { isClosed: event.isClosed }),
            },
          ],
        },
      };
    }

    // Trading lifecycle events (from trading WebSocket)
    if (TRADING_LIFECYCLE_EVENT_TYPES.has(event.type)) {
      return {
        data: {
          symbol,
          type,
          order: _timing ? { symbol, type, source, ...cleanEventData } : event,
          _seq: event._seq,
          _orderingDomain: event._orderingDomain,
        },
      };
    }

    // Include timeframe in the data payload (useful for kline interval)
    return {
      data: {
        symbol,
        type,
        timeframe: event.timeframe,
        _seq: event._seq,
        _orderingDomain: event._orderingDomain,
        [dataKey]: cleanEventData,
      },
    };
  }

  private resolveTradingRoutingKey(event: CorezaMarketEvent): string {
    const tradingSource = `${event.source}_trading`;
    const nativeEventType =
      event.rawOrderData?.e ||
      (event.type === "algo_update"
        ? "ALGO_UPDATE"
        : event.type === "listen_key_expired"
          ? "listenKeyExpired"
          : "ORDER_TRADE_UPDATE");
    return tradingRoutingKey(tradingSource, nativeEventType);
  }

  private enqueueWorkflowDelivery(
    workflowId: string,
    registration: WorkflowRegistration,
    event: CorezaMarketEvent,
  ): void {
    const domain = event._orderingDomain || `${event.source}:${event.type}`;
    const queueKey = `${workflowId}:${domain}`;
    const enqueueAt = Date.now();
    const queuedAt = registration.isLive ? timingNow() : 0;
    if (LIVE_TIMING_ENABLED && registration.isLive) {
      changeIngressQueueDepth(1);
      countLive("delivery", "enqueued");
    }
    const orderId = event.orderId || event.clientOrderId;

    if (LOG) logger.debug(
      {
        workflowId,
        queueKey,
        orderId,
        symbol: event.symbol,
        eventType: event.type,
        orderEvent: event.orderEvent,
        orderStatus: event.orderStatus,
        seq: event._seq,
        orderingDomain: domain,
        enqueueAt,
      },
      "Workflow delivery enqueued",
    );

    const prev = this.deliveryQueues.get(queueKey) ?? Promise.resolve();
    const next = prev.then(async () => {
      if (LIVE_TIMING_ENABLED && registration.isLive) {
        changeIngressQueueDepth(-1);
        observeStage("subscriber_queue_wait", queuedAt);
      }
      if (
        !registration.isLive &&
        TRADING_LIFECYCLE_EVENT_TYPES.has(event.type)
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, ORDER_UPDATE_DELAY_MS),
        );
      }
      await this.deliverWorkflowEvent(
        workflowId,
        registration,
        event,
        enqueueAt,
      );
    });
    const trackedNext = next.catch((error) => {
      logger.error(
        {
          err: error,
          workflowId,
          queueKey,
          orderId,
          seq: event._seq,
          orderingDomain: domain,
        },
        "Workflow delivery queue task failed",
      );
    });
    this.deliveryQueues.set(queueKey, trackedNext);
    trackedNext.finally(() => {
      if (this.deliveryQueues.get(queueKey) === trackedNext) {
        this.deliveryQueues.delete(queueKey);
      }
    });
  }

  private async publishToFrontend(
    registration: WorkflowRegistration,
    formattedPayload: { data: Record<string, any> },
    event: CorezaMarketEvent,
  ): Promise<void> {
    const userChannel = `ws:user:${registration.userId}`;
    const payload = JSON.stringify({
      type: "market_data",
      payload: {
        nodeId: registration.nodeId,
        source: registration.source,
        workflowId: registration.workflowId,
        data: formattedPayload.data,
      },
    });
    await redisPublishBreaker.fire(userChannel, payload);
    if (LOG) logger.debug(
      {
        userId: registration.userId,
        workflowId: registration.workflowId,
        symbol: event.symbol,
        eventType: event.type,
        seq: event._seq,
        orderingDomain:
          event._orderingDomain || `${event.source}:${event.type}`,
      },
      "Published market data to user channel",
    );
  }

  getRegistration(workflowId: string): WorkflowRegistration | undefined {
    return this.registrations.get(workflowId);
  }

  private async appendToWorkflowStream(
    queueKey: string,
    streamKey: string,
    payload: string,
    isLive: boolean,
  ): Promise<string> {
    const redis = getRedisCache();
    const startedAt = timingNow();
    let outcome = "error";
    try {
      const entryId = await redis.xadd(
        streamKey,
        "MAXLEN",
        "~",
        "1000",
        "*",
        "event",
        payload,
      );
      if (!entryId) {
        throw new Error("Redis xadd did not return a stream entry ID");
      }
      outcome = "success";
      if (LOG) logger.debug(
        { queueKey, streamKey, entryId },
        "Appended market event to strategy stream",
      );
      return entryId;
    } finally {
      if (isLive) {
        observeStage("xadd", startedAt, outcome);
        countLive("append", outcome);
      }
    }
  }

  /**
   * Deliver market event for one workflow in strict queue order:
   * 1) append to backend strategy stream
   * 2) publish frontend update with Redis stream entry cursor
   */
  private async deliverWorkflowEvent(
    workflowId: string,
    registration: WorkflowRegistration,
    event: CorezaMarketEvent,
    enqueueAt: number,
  ): Promise<void> {
    const domain = event._orderingDomain || `${event.source}:${event.type}`;
    const queueKey = `${workflowId}:${domain}`;
    const streamKey = RedisKeys.strategyStream(registration.userId, workflowId);
    const orderId = event.orderId || event.clientOrderId;
    try {
      // Registration owns delivery eligibility. Do not refresh a TTL-based
      // database cache on the event path, or deliver queued work after retirement.
      if (this.registrations.get(workflowId) !== registration) {
        if (registration.isLive) countLive("delivery", "retired_registration");
        return;
      }

      // Format market event to match frontend structure
      const formattedPayload = this.formatMarketEventPayload(event);
      const payloadStr = JSON.stringify(event._timing ? { ...formattedPayload, _timing: event._timing } : formattedPayload);
      const executeAt = Date.now();

      if (LOG) logger.debug(
        {
          workflowId,
          queueKey,
          orderId,
          symbol: event.symbol,
          eventType: event.type,
          orderEvent: event.orderEvent,
          orderStatus: event.orderStatus,
          seq: event._seq,
          orderingDomain: domain,
          enqueueAt,
          executeAt,
          queueWaitMs: executeAt - enqueueAt,
        },
        "Workflow delivery dequeued",
      );

      const entryId = await this.appendToWorkflowStream(
        queueKey,
        streamKey,
        payloadStr,
        registration.isLive,
      );
      if (LIVE_TIMING_ENABLED && registration.isLive) observeIngress(
        event._timing?.barEligibleAt ?? event._timing?.gatewayReceivedAt,
        entryId,
        liveEventKind(event._timing?.eventKind ?? event.type),
      );
      const payloadWithEntryId = {
        ...formattedPayload,
        data: {
          ...formattedPayload.data,
          _entryId: entryId,
        },
      };

      if (!registration.isLive) {
        try {
          await this.publishToFrontend(registration, payloadWithEntryId, event);
        } catch (error) {
          logger.error(
            { err: error, userId: registration.userId, workflowId, queueKey },
            "Failed to publish market data to user channel",
          );
        }
      }

      if (LOG) logger.debug(
        {
          workflowId,
          queueKey,
          orderId,
          seq: event._seq,
          orderingDomain: domain,
          symbol: event.symbol,
          orderStatus: event.orderStatus,
          executeAt,
          completeAt: Date.now(),
        },
        "Completed workflow delivery",
      );
    } catch (error) {
      logger.error(
        {
          err: error,
          workflowId,
          userId: registration.userId,
          symbol: event.symbol,
          queueKey,
          orderId,
          seq: event._seq,
          orderingDomain: domain,
        },
        "Workflow delivery error",
      );
      if (registration.isLive) countLive("delivery", "error");
    }
  }

  /**
   * Add new stream to an existing workflow registration
   * Used when new stream are subscribed after a streaming workflow is already active
   */
  async addStreamsToRegistration(
    workflowId: string,
    newStreams: string[],
    newTradingNativeStreams: string[] = [],
  ): Promise<void> {
    const registration = this.registrations.get(workflowId);

    if (!registration) {
      console.warn(
        `⚠️ [MarketDataSubscriber] No registration found for workflow ${workflowId}`,
      );
      return;
    }

    console.log(
      `➕ [MarketDataSubscriber] Adding stream to workflow ${workflowId}:`,
      newStreams,
    );

    const streamsToMap = new Set<string>();
    for (const stream of newStreams) {
      if (!registration.streams.has(stream)) {
        registration.streams.add(stream);
      }
      streamsToMap.add(stream);

      if (TRADING_LIFECYCLE_EVENT_TYPES.has(stream)) {
        registration.tradingNativeStreams.add(stream);
      }
    }

    for (const stream of this.getRedisSubscriptionStreams(registration)) {
      if (!streamsToMap.has(stream) && !newStreams.includes(stream)) {
        const rawMatchesNewAggregatedStream = newStreams.some(
          (newStream) =>
            registration.interval &&
            this.stripAggregationInterval(newStream, registration.interval) ===
              stream,
        );
        if (!rawMatchesNewAggregatedStream) continue;
      }

      // Update stream→workflow mapping
      if (!this.streamWorkflows.has(stream)) {
        this.streamWorkflows.set(stream, new Set());

        // Subscribe to Redis channel for this stream
        const channel = REDIS_CHANNELS.streamData(stream);
        const { sub } = this.ensureRedisConnections();
        await sub.subscribe(channel);
        console.log(
          `📊 [MarketDataSubscriber] Subscribed to Redis channel: ${channel}`,
        );
      }
      this.streamWorkflows.get(stream)!.add(workflowId);
    }

    newTradingNativeStreams.forEach((stream) =>
      registration.tradingNativeStreams.add(stream),
    );

    // Persist updated registration to Redis
    await this.persistRegistration(registration);

    console.log(
      `✅ [MarketDataSubscriber] Added ${newStreams.length} stream to workflow ${workflowId}`,
    );
  }

  async addAllowedSymbolsToRegistration(
    workflowId: string,
    symbols: string[],
  ): Promise<void> {
    const registration = this.registrations.get(workflowId);
    if (!registration) return;

    const broker = String(registration.source).split("_")[0];
    symbols
      .map((symbol) => normalizeOrderSymbol(symbol, broker))
      .forEach((symbol) => registration.allowedSymbols.add(symbol));

    await this.persistRegistration(registration);
  }

  async removeAllowedSymbolsFromRegistration(
    workflowId: string,
    symbols: string[],
  ): Promise<void> {
    const registration = this.registrations.get(workflowId);
    if (!registration) return;

    const broker = String(registration.source).split("_")[0];
    symbols
      .map((symbol) => normalizeOrderSymbol(symbol, broker))
      .forEach((symbol) => registration.allowedSymbols.delete(symbol));

    await this.persistRegistration(registration);
  }

  /**
   * Remove specific streams from an existing workflow registration.
   * If no streams remain after removal, the workflow registration is removed entirely.
   */
  async removeStreamsFromRegistration(
    userId: string,
    workflowId: string,
    streamsToRemove: string[],
  ): Promise<void> {
    const registration = this.registrations.get(workflowId);

    if (!registration) {
      console.warn(
        `⚠️ [MarketDataSubscriber] No registration found for workflow ${workflowId}`,
      );
      return;
    }

    console.log(
      `➖ [MarketDataSubscriber] Removing streams from workflow ${workflowId}:`,
      streamsToRemove,
    );

    const redisStreamsToRemove = new Set<string>();
    for (const stream of streamsToRemove) {
      if (!registration.streams.has(stream)) {
        continue;
      }

      registration.streams.delete(stream);
      registration.tradingNativeStreams.delete(stream);
      redisStreamsToRemove.add(stream);
      if (registration.interval) {
        redisStreamsToRemove.add(
          this.stripAggregationInterval(stream, registration.interval),
        );
      }
    }

    for (const stream of redisStreamsToRemove) {
      const workflows = this.streamWorkflows.get(stream);
      if (workflows) {
        workflows.delete(workflowId);

        if (workflows.size === 0) {
          const channel = REDIS_CHANNELS.streamData(stream);
          const { sub } = this.ensureRedisConnections();
          await sub.unsubscribe(channel);
          this.streamWorkflows.delete(stream);
          console.log(
            `📊 [MarketDataSubscriber] Unsubscribed from Redis channel: ${channel}`,
          );
        }
      }
    }

    if (registration.streams.size === 0) {
      await this.unregisterWorkflow(userId, workflowId);
      return;
    }

    await this.persistRegistration(registration);
    console.log(
      `✅ [MarketDataSubscriber] Removed ${streamsToRemove.length} stream(s) from workflow ${workflowId}`,
    );
  }

  /**
   * Persist workflow registration to Redis (with circuit breaker)
   */
  private async persistRegistration(
    registration: WorkflowRegistration,
  ): Promise<void> {
    const key = REDIS_CHANNELS.workflowRegistration(
      registration.userId,
      registration.workflowId,
    );
    const data = JSON.stringify({
      workflowId: registration.workflowId,
      nodeId: registration.nodeId,
      userId: registration.userId,
      streams: Array.from(registration.streams),
      source: registration.source,
      filterSymbols: Array.from(registration.allowedSymbols),
      symbolMatchMode: registration.symbolMatchMode,
      tradingNativeStreams: Array.from(registration.tradingNativeStreams),
      onlyClosedBars: registration.onlyClosedBars,
      interval: registration.interval,
      isLive: registration.isLive,
    });

    try {
      await redisSetBreaker.fire(key, data);
    } catch (error) {
      console.warn(
        `⚠️ [MarketDataSubscriber] Failed to persist registration to Redis, continuing with in-memory state`,
      );
      // Continue - registration is still active in memory
    }
  }

  /**
   * Get statistics about current workflow registrations
   */
  getStats(): {
    totalWorkflows: number;
    totalStreams: number;
    registrations: Array<{
      workflowId: string;
      streams: string[];
      source: MarketSource;
    }>;
  } {
    return {
      totalWorkflows: this.registrations.size,
      totalStreams: this.streamWorkflows.size,
      registrations: Array.from(this.registrations.values()).map((reg) => ({
        workflowId: reg.workflowId,
        streams: Array.from(reg.streams),
        source: reg.source,
      })),
    };
  }

  /**
   * Get workflow registration IDs currently held in memory for a given user.
   * Used as a fallback path when Redis tracking keys are missing or stale.
   */
  getRegisteredWorkflowIdsForUser(userId: string): string[] {
    return Array.from(this.registrations.values())
      .filter((registration) => registration.userId === userId)
      .map((registration) => registration.workflowId);
  }

  /**
   * Cleanup resources and prevent memory leaks
   */
  async cleanup(): Promise<void> {
    console.log(`📊 [MarketDataSubscriber] Cleaning up...`);

    // Remove message handler
    if (this.messageHandler && this.redisSub) {
      this.redisSub.off("message", this.messageHandler);
      this.messageHandler = null;
    }

    // Unsubscribe from all channels
    if (this.redisSub) {
      await this.redisSub.unsubscribe();
    }

    if (this.aggregationSweep) {
      clearInterval(this.aggregationSweep);
      this.aggregationSweep = null;
    }

    // Clear memory
    this.registrations.clear();
    this.streamWorkflows.clear();
    this.deliveryQueues.clear();

    this.isInitialized = false;

    console.log(`✅ [MarketDataSubscriber] Cleanup complete`);
  }
}

export default MarketDataSubscriber;
