import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import { createRedisPubSub, getRedisCache } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import {
  CorezaMarketEvent,
  MarketSource,
  MarketEventType,
} from "../types/marketEvent";
import { bullMqJobQueue } from "./jobQueueManager";
import WorkflowCache from "./WorkflowCache";
import {
  redisPublishBreaker,
  redisSetBreaker,
} from "../utils/redisCircuitBreaker";
import logger from "../utils/logger";
import { getSourceMapping } from "../marketGateways";

/**
 * Workflow registration metadata for receiving market data
 * This is NOT a broker subscription - it registers a workflow to receive data
 * from already-subscribed market data channels
 */
interface WorkflowRegistration {
  workflowId: string;
  nodeId: string;
  userId: string;
  symbols: Set<string>;
  source?: MarketSource;
  eventTypes?: MarketEventType[];
}

export class MarketDataSubscriber {
  private static instance: MarketDataSubscriber;

  // workflowId → registration metadata
  private registrations = new Map<string, WorkflowRegistration>();

  // symbol → Set<workflowId> for fast lookup
  private symbolWorkflows = new Map<string, Set<string>>();

  private redisSub: Redis | null = null;
  private redisPub: Redis | null = null;
  private isInitialized = false;
  private messageHandler:
    | ((channel: string, message: string) => Promise<void>)
    | null = null;

  private constructor() {
    // Lazy initialization - don't create Redis connections here
  }

  private ensureRedisConnections(): { pub: Redis; sub: Redis } {
    if (!this.redisSub || !this.redisPub) {
      const { pub, sub } = createRedisPubSub();
      this.redisSub = sub;
      this.redisPub = pub;
    }
    return { pub: this.redisPub, sub: this.redisSub };
  }

  private getWorkflowCache(): WorkflowCache {
    return WorkflowCache.getInstance();
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
    symbols: string[],
    source?: MarketSource | string,
  ): Promise<void> {
    try {
      console.log(
        `📊 [MarketDataSubscriber] Registering workflow ${workflowId} for symbols:`,
        symbols,
      );

      // Create registration object
      const registration: WorkflowRegistration = {
        workflowId,
        nodeId,
        userId,
        symbols: new Set(symbols.map((s) => s.toUpperCase())),
        source,
      };

      // Store in memory
      this.registrations.set(workflowId, registration);

      // Update symbol→workflow mapping
      for (const symbol of registration.symbols) {
        if (!this.symbolWorkflows.has(symbol)) {
          this.symbolWorkflows.set(symbol, new Set());

          // Subscribe to Redis channel for this symbol
          const channel = REDIS_CHANNELS.marketData(symbol);
          const { sub } = this.ensureRedisConnections();
          await sub.subscribe(channel);
          console.log(
            `📊 [MarketDataSubscriber] Subscribed to Redis channel: ${channel}`,
          );
          console.log(
            `🟢 [DEBUG-2] Current subscribed channels:`,
            this.symbolWorkflows.keys(),
          );
        }
        this.symbolWorkflows.get(symbol)!.add(workflowId);
      }

      // Persist to Redis
      await this.persistRegistration(registration);

      // Initialize message handler if not already done
      if (!this.isInitialized) {
        this.setupMessageHandler();
        this.isInitialized = true;
      }

      console.log(
        `✅ [MarketDataSubscriber] Workflow ${workflowId} registered successfully`,
      );
    } catch (error) {
      console.error(`❌ [MarketDataSubscriber] Register error:`, error);
      throw error;
    }
  }

  /**
   * Unregister a workflow from receiving market data streams
   * This does NOT unsubscribe from a broker - it removes the workflow from
   * the internal routing table
   */
  async unregisterWorkflow(userId: string, workflowId: string): Promise<void> {
    try {
      console.log(
        `📊 [MarketDataSubscriber] Unregistering workflow ${workflowId}`,
      );

      const registration = this.registrations.get(workflowId);
      if (!registration) {
        console.warn(
          `⚠️  [MarketDataSubscriber] No registration found for workflow ${workflowId}`,
        );
        return;
      }

      // Remove from symbol→workflow mapping
      for (const symbol of registration.symbols) {
        const workflows = this.symbolWorkflows.get(symbol);
        if (workflows) {
          workflows.delete(workflowId);

          // If no more workflows need this symbol, unsubscribe from Redis channel
          if (workflows.size === 0) {
            const channel = REDIS_CHANNELS.marketData(symbol);
            const { sub } = this.ensureRedisConnections();
            await sub.unsubscribe(channel);
            this.symbolWorkflows.delete(symbol);
            console.log(
              `📊 [MarketDataSubscriber] Unsubscribed from Redis channel: ${channel}`,
            );
          }
        }
      }

      // Remove from memory
      this.registrations.delete(workflowId);

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
      // Use user-scoped pattern: md:user:{userId}:wf:reg:{workflowId}
      const pattern = "md:user:*:wf:reg:*";
      const keys = await pub.keys(pattern);

      let restored = 0;
      for (const key of keys) {
        try {
          const data = await pub.get(key);
          if (!data) continue;

          const registration = JSON.parse(data) as {
            workflowId: string;
            nodeId: string;
            userId: string;
            symbols: string[];
            source?: MarketSource;
          };

          // Verify workflow is still active (use cache)
          const workflow = await this.getWorkflowCache().getWorkflow(
            registration.workflowId,
          );

          if (!workflow?.is_active) {
            console.log(
              `⚠️  Skipping inactive workflow ${registration.workflowId}`,
            );
            await pub.del(key);
            continue;
          }

          // Restore registration
          await this.registerWorkflow(
            registration.workflowId,
            registration.nodeId,
            registration.userId,
            registration.symbols,
            registration.source,
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
        console.log(`🟣 [DEBUG-3] MESSAGE RECEIVED on channel: ${channel}`);
        console.log(`🟣 [DEBUG-3] Raw message:`, message.substring(0, 200));
        // Parse market event
        const event: CorezaMarketEvent = JSON.parse(message);

        // Validate that this is a proper market event, not a Redis control message
        if (
          !event ||
          typeof event !== "object" ||
          !event.symbol ||
          !event.type
        ) {
          // Not a valid CorezaMarketEvent, skip (could be subscription confirmation)
          return;
        }

        // Find workflows registered for this symbol
        const workflows = this.symbolWorkflows.get(event.symbol.toUpperCase());
        if (!workflows || workflows.size === 0) return;

        // Handle wildcard registrations (*)
        const wildcardWorkflows = this.symbolWorkflows.get("*");
        const allWorkflows = new Set([
          ...(workflows || []),
          ...(wildcardWorkflows || []),
        ]);

        logger.debug(
          {
            symbol: event.symbol,
            type: event.type,
            workflowCount: allWorkflows.size,
          },
          "Received market event",
        );

        // Trigger each registered workflow
        for (const workflowId of allWorkflows) {
          const registration = this.registrations.get(workflowId);
          if (!registration) continue;

          // Filter by source if specified
          if (
            registration.source &&
            registration.source.split("_")[0] !== event.source
          )
            continue;

          // Format event using shared helper (same format for frontend and backend)
          const formattedPayload = this.formatMarketEventPayload(event);

          // Publish market data to Redis for WebSocketManager to forward to frontend
          try {
            const userChannel = `ws:user:${registration.userId}`;

            const payload = JSON.stringify({
              type: "market_data",
              payload: {
                nodeId: registration.nodeId,
                data: formattedPayload.data,
              },
            });

            await redisPublishBreaker.fire(userChannel, payload);

            logger.debug(
              {
                userId: registration.userId,
                symbol: event.symbol,
                eventType: event.type,
              },
              "Published market data to user channel",
            );
          } catch (error) {
            logger.error(
              { err: error, userId: registration.userId },
              "Failed to publish market data to user channel",
            );
          }

          // Skip workflow execution for test listeners (they only need WebSocket data)
          if (workflowId.startsWith("stream:test:")) {
            logger.debug(
              { workflowId },
              "Skipping workflow execution for test listener",
            );
            continue;
          }

          // Trigger backend workflow execution with same formatted payload
          await this.triggerWorkflowExecution(
            workflowId,
            registration.userId,
            event,
            registration.nodeId,
          );
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

  /**
   * Format CorezaMarketEvent to REST-like structure
   * Used for both frontend WebSocket and backend workflow execution
   */
  private formatMarketEventPayload(event: CorezaMarketEvent): {
    data: Record<string, any>;
  } {
    const { symbol, type, source, ...cleanEventData } = event;

    const typeKeyMap: Record<string, string> = {
      bar: "bar",
      daily_bar: "bar",
      trade: "trade",
      quote: "quote",
      ticker: "ticker",
      news: "news",
    };
    const dataKey = typeKeyMap[type] || type;

    // Include timeframe in the data payload (useful for kline interval)
    return {
      data: {
        symbol,
        type,
        timeframe: event.timeframe,
        [dataKey]: cleanEventData,
      },
    };
  }

  /**
   * Trigger workflow execution with market event
   * Uses Redis-first storage for high-frequency performance
   */
  private async triggerWorkflowExecution(
    workflowId: string,
    userId: string,
    event: CorezaMarketEvent,
    nodeId: string,
  ): Promise<void> {
    try {
      // Fetch workflow definition from cache (60s TTL)
      const workflow = await this.getWorkflowCache().getWorkflow(workflowId);

      if (!workflow) {
        console.error(
          `❌ [MarketDataSubscriber] Workflow ${workflowId} not found or inactive`,
        );
        return;
      }

      if (!workflow.is_active) {
        console.log(
          `⚠️  [MarketDataSubscriber] Workflow ${workflowId} is not active, skipping execution`,
        );
        return;
      }

      // Generate run ID locally (no Supabase round-trip)
      const runId = uuidv4();
      const redis = getRedisCache();

      // Store run metadata in Redis hash (instant, no DB latency)
      const runData = {
        id: runId,
        workflow_id: workflowId,
        initiated_by: userId,
        status: "queued",
        started_at: new Date().toISOString(),
      };

      await redis.hset(`runs:data:${runId}`, runData);
      await redis.expire(`runs:data:${runId}`, 86400); // 24 hour TTL

      // Add to pending sync list
      await redis.lpush("runs:pending:all", runId);

      // Format market event to match frontend structure
      const formattedPayload = this.formatMarketEventPayload(event);

      // Add job to BullMQ queue with Redis storage flag
      try {
        await bullMqJobQueue.addWorkflowExecution({
          runId,
          workflowId,
          userId,
          nodes: workflow.nodes,
          edges: workflow.edges,
          trigger: "market_data",
          initialInput: formattedPayload,
          useRedisStorage: true, // Use Redis instead of direct Supabase
        });

        logger.debug(
          {
            workflowId,
            runId,
            symbol: event.symbol,
          },
          "Queued workflow execution (Redis-first)",
        );
      } catch (queueError) {
        logger.error(
          { err: queueError, workflowId, runId },
          "Failed to add workflow to execution queue",
        );
        // Clean up Redis entry on queue failure
        await redis.del(`runs:data:${runId}`);
        await redis.lrem("runs:pending:all", 1, runId);
      }
    } catch (error) {
      logger.error(
        { err: error, workflowId, userId, symbol: event.symbol },
        "Trigger workflow error",
      );
    }
  }

  /**
   * Add new symbols to an existing workflow registration
   * Used when new symbols are subscribed after a streaming workflow is already active
   */
  async addSymbolsToRegistration(
    workflowId: string,
    newSymbols: string[],
  ): Promise<void> {
    const registration = this.registrations.get(workflowId);

    if (!registration) {
      console.warn(
        `⚠️ [MarketDataSubscriber] No registration found for workflow ${workflowId}`,
      );
      return;
    }

    console.log(
      `➕ [MarketDataSubscriber] Adding symbols to workflow ${workflowId}:`,
      newSymbols,
    );

    for (const symbol of newSymbols) {
      const upperSymbol = symbol.toUpperCase();

      // Skip if already registered
      if (registration.symbols.has(upperSymbol)) {
        continue;
      }

      // Add to registration's symbol set
      registration.symbols.add(upperSymbol);

      // Update symbol→workflow mapping
      if (!this.symbolWorkflows.has(upperSymbol)) {
        this.symbolWorkflows.set(upperSymbol, new Set());

        // Subscribe to Redis channel for this symbol
        const channel = REDIS_CHANNELS.marketData(upperSymbol);
        const { sub } = this.ensureRedisConnections();
        await sub.subscribe(channel);
        console.log(
          `📊 [MarketDataSubscriber] Subscribed to Redis channel: ${channel}`,
        );
      }
      this.symbolWorkflows.get(upperSymbol)!.add(workflowId);
    }

    // Persist updated registration to Redis
    await this.persistRegistration(registration);

    console.log(
      `✅ [MarketDataSubscriber] Added ${newSymbols.length} symbols to workflow ${workflowId}`,
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
      symbols: Array.from(registration.symbols),
      source: registration.source,
      eventTypes: registration.eventTypes,
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
    totalSymbols: number;
    registrations: Array<{
      workflowId: string;
      symbols: string[];
      source?: MarketSource;
    }>;
  } {
    return {
      totalWorkflows: this.registrations.size,
      totalSymbols: this.symbolWorkflows.size,
      registrations: Array.from(this.registrations.values()).map((reg) => ({
        workflowId: reg.workflowId,
        symbols: Array.from(reg.symbols),
        source: reg.source,
      })),
    };
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

    // Clear memory
    this.registrations.clear();
    this.symbolWorkflows.clear();

    this.isInitialized = false;

    console.log(`✅ [MarketDataSubscriber] Cleanup complete`);
  }
}

export default MarketDataSubscriber;
