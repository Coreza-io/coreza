import Redis from "ioredis";
import { createRedisPubSub } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import {
  CorezaMarketEvent,
  MarketSource,
  MarketEventType,
} from "../types/marketEvent";
import { supabase } from "../config/supabase";
import { bullMqJobQueue } from "./jobQueueManager";
import WorkflowCache from "./WorkflowCache";
import {
  redisPublishBreaker,
  redisSetBreaker,
} from "../utils/redisCircuitBreaker";
import logger from "../utils/logger";
import { retrySupabaseOperation } from "../utils/retryHelper";

interface WorkflowSubscription {
  workflowId: string;
  nodeId: string;
  userId: string;
  symbols: Set<string>;
  source?: MarketSource;
  eventTypes?: MarketEventType[];
}

export class MarketDataSubscriber {
  private static instance: MarketDataSubscriber;

  // workflowId → subscription metadata
  private subscriptions = new Map<string, WorkflowSubscription>();

  // symbol → Set<workflowId> for fast lookup
  private symbolWorkflows = new Map<string, Set<string>>();

  private redisSub: Redis;
  private redisPub: Redis;
  private isInitialized = false;
  private messageHandler:
    | ((channel: string, message: string) => Promise<void>)
    | null = null;
  private workflowCache = WorkflowCache;

  private constructor() {
    // Create isolated Redis connections for this service
    const { pub, sub } = createRedisPubSub();
    this.redisSub = sub; // Dedicated subscriber connection
    this.redisPub = pub; // Dedicated publisher connection
  }

  static getInstance(): MarketDataSubscriber {
    if (!MarketDataSubscriber.instance) {
      MarketDataSubscriber.instance = new MarketDataSubscriber();
    }
    return MarketDataSubscriber.instance;
  }

  /**
   * Subscribe a workflow to market data streams
   */
  async subscribe(
    workflowId: string,
    nodeId: string,
    userId: string,
    symbols: string[],
    options?: {
      source?: MarketSource;
      eventTypes?: MarketEventType[];
    }
  ): Promise<void> {
    try {
      console.log(
        `📊 [MarketDataSubscriber] Subscribing workflow ${workflowId} to symbols:`,
        symbols
      );

      // Create subscription object
      const subscription: WorkflowSubscription = {
        workflowId,
        nodeId,
        userId,
        symbols: new Set(symbols.map((s) => s.toUpperCase())),
        source: options?.source,
        eventTypes: options?.eventTypes,
      };

      // Store in memory
      this.subscriptions.set(workflowId, subscription);

      // Update symbol→workflow mapping
      for (const symbol of subscription.symbols) {
        if (!this.symbolWorkflows.has(symbol)) {
          this.symbolWorkflows.set(symbol, new Set());

          // Subscribe to Redis channel for this symbol
          const channel = REDIS_CHANNELS.marketData(symbol);
          await this.redisSub.subscribe(channel);
          console.log(
            `📊 [MarketDataSubscriber] Subscribed to Redis channel: ${channel}`
          );
          console.log(
            `🟢 [DEBUG-2] Current subscribed channels:`,
            this.symbolWorkflows.keys()
          );
        }
        this.symbolWorkflows.get(symbol)!.add(workflowId);
      }

      // Persist to Redis
      await this.persistSubscription(subscription);

      // Initialize message handler if not already done
      if (!this.isInitialized) {
        this.setupMessageHandler();
        this.isInitialized = true;
      }

      console.log(
        `✅ [MarketDataSubscriber] Workflow ${workflowId} subscribed successfully`
      );
    } catch (error) {
      console.error(`❌ [MarketDataSubscriber] Subscribe error:`, error);
      throw error;
    }
  }

  /**
   * Unsubscribe a workflow from market data streams
   */
  async unsubscribe(workflowId: string): Promise<void> {
    try {
      console.log(
        `📊 [MarketDataSubscriber] Unsubscribing workflow ${workflowId}`
      );

      const subscription = this.subscriptions.get(workflowId);
      if (!subscription) {
        console.warn(
          `⚠️  [MarketDataSubscriber] No subscription found for workflow ${workflowId}`
        );
        return;
      }

      // Remove from symbol→workflow mapping
      for (const symbol of subscription.symbols) {
        const workflows = this.symbolWorkflows.get(symbol);
        if (workflows) {
          workflows.delete(workflowId);

          // If no more workflows need this symbol, unsubscribe from Redis
          if (workflows.size === 0) {
            const channel = REDIS_CHANNELS.marketData(symbol);
            await this.redisSub.unsubscribe(channel);
            this.symbolWorkflows.delete(symbol);
            console.log(
              `📊 [MarketDataSubscriber] Unsubscribed from Redis channel: ${channel}`
            );
          }
        }
      }

      // Remove from memory
      this.subscriptions.delete(workflowId);

      // Remove from Redis persistence
      await this.redisPub.del(REDIS_CHANNELS.workflowSubscription(workflowId));

      console.log(
        `✅ [MarketDataSubscriber] Workflow ${workflowId} unsubscribed successfully`
      );
    } catch (error) {
      console.error(`❌ [MarketDataSubscriber] Unsubscribe error:`, error);
      throw error;
    }
  }

  /**
   * Restore subscriptions from Redis on startup
   */
  async restoreFromRedis(): Promise<void> {
    try {
      console.log(
        `📊 [MarketDataSubscriber] Restoring subscriptions from Redis...`
      );

      const pattern = "wf:sub:*";
      const keys = await this.redisPub.keys(pattern);

      let restored = 0;
      for (const key of keys) {
        try {
          const data = await this.redisPub.get(key);
          if (!data) continue;

          const subscription = JSON.parse(data) as {
            workflowId: string;
            nodeId: string;
            userId: string;
            symbols: string[];
            source?: MarketSource;
            eventTypes?: MarketEventType[];
          };

          // Verify workflow is still active (use cache)
          const workflow = await this.workflowCache.getWorkflow(
            subscription.workflowId
          );

          if (!workflow?.is_active) {
            console.log(
              `⚠️  Skipping inactive workflow ${subscription.workflowId}`
            );
            await this.redisPub.del(key);
            continue;
          }

          // Restore subscription
          await this.subscribe(
            subscription.workflowId,
            subscription.nodeId,
            subscription.userId,
            subscription.symbols,
            {
              source: subscription.source,
              eventTypes: subscription.eventTypes,
            }
          );

          restored++;
        } catch (err) {
          console.error(`Failed to restore subscription from key ${key}:`, err);
        }
      }

      console.log(
        `✅ [MarketDataSubscriber] Restored ${restored} subscriptions from Redis`
      );
    } catch (error) {
      console.error(`❌ [MarketDataSubscriber] Restore error:`, error);
    }
  }

  /**
   * Setup Redis message handler with memory leak prevention
   */
  private setupMessageHandler(): void {
    // Remove existing handler to prevent duplicates
    if (this.messageHandler) {
      this.redisSub.off("message", this.messageHandler);
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

        // Find workflows subscribed to this symbol
        const workflows = this.symbolWorkflows.get(event.symbol.toUpperCase());
        if (!workflows || workflows.size === 0) return;

        // Handle wildcard subscriptions (*)
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
          "Received market event"
        );

        // Trigger each workflow
        for (const workflowId of allWorkflows) {
          const subscription = this.subscriptions.get(workflowId);
          if (!subscription) continue;

          // Filter by source if specified
          if (subscription.source && subscription.source !== event.source)
            continue;

          // Filter by event type if specified
          if (
            subscription.eventTypes &&
            !subscription.eventTypes.includes(event.type)
          )
            continue;

          // Publish market data to Redis for WebSocketManager to forward to frontend
          try {
            const userChannel = `ws:user:${subscription.userId}`;
            const payload = JSON.stringify({
              type: "market_data",
              payload: {
                nodeId: subscription.nodeId,
                data: event,
              },
            });

            await redisPublishBreaker.fire(userChannel, payload);

            logger.debug(
              {
                userId: subscription.userId,
                symbol: event.symbol,
                eventType: event.type,
              },
              "Published market data to user channel"
            );
          } catch (error) {
            logger.error(
              { err: error, userId: subscription.userId },
              "Failed to publish market data to user channel"
            );
          }

          await this.triggerWorkflowExecution(
            workflowId,
            subscription.userId,
            event
          );
        }
      } catch (error) {
        console.error(
          `❌ [MarketDataSubscriber] Message handler error:`,
          error
        );
      }
    };

    // Attach handler
    this.redisSub.on("message", this.messageHandler);
    console.log(`✅ [MarketDataSubscriber] Message handler setup complete`);

    console.log(`🟡 [SUBSCRIBER] Handler attached to redisSub`);
    console.log(`🟡 [SUBSCRIBER] redisSub.status: ${this.redisSub.status}`);

    console.log(`✅ [MarketDataSubscriber] Message handler setup complete`);
  }

  /**
   * Trigger workflow execution with market event
   * Uses WorkflowCache to avoid repeated Supabase queries (60s cache)
   */
  private async triggerWorkflowExecution(
    workflowId: string,
    userId: string,
    event: CorezaMarketEvent
  ): Promise<void> {
    try {
      // Fetch workflow definition from cache (60s TTL)
      const workflow = await this.workflowCache.getWorkflow(workflowId);

      if (!workflow) {
        console.error(
          `❌ [MarketDataSubscriber] Workflow ${workflowId} not found or inactive`
        );
        return;
      }

      if (!workflow.is_active) {
        console.log(
          `⚠️  [MarketDataSubscriber] Workflow ${workflowId} is not active, skipping execution`
        );
        return;
      }

      // Create workflow run entry with retry logic
      const { data: runData, error: runError } = await retrySupabaseOperation(
        async () => {
          return await supabase
            .from("workflow_runs")
            .insert({
              workflow_id: workflowId,
              initiated_by: userId,
              status: "queued",
            })
            .select("id")
            .single();
        },
        "Create workflow_runs entry"
      );

      if (runError || !runData) {
        logger.error(
          { err: runError, workflowId, userId },
          "Failed to create workflow run after retries"
        );
        return;
      }

      const runId = runData.id;

      // Add job to BullMQ queue with market event as initial input
      try {
        await bullMqJobQueue.addWorkflowExecution({
          runId,
          workflowId,
          userId,
          nodes: workflow.nodes,
          edges: workflow.edges,
          trigger: "webhook",
          initialInput: { marketEvent: event },
        });

        logger.info(
          {
            workflowId,
            runId,
            workflowName: workflow.name,
            symbol: event.symbol,
          },
          "Queued workflow execution successfully"
        );
      } catch (queueError) {
        logger.error(
          { err: queueError, workflowId, runId },
          "Failed to add workflow to execution queue"
        );
        // Don't throw - workflow_runs entry already created, just log the failure
      }
    } catch (error) {
      logger.error(
        { err: error, workflowId, userId, symbol: event.symbol },
        "Trigger workflow error"
      );
    }
  }

  /**
   * Persist subscription to Redis (with circuit breaker)
   */
  private async persistSubscription(
    subscription: WorkflowSubscription
  ): Promise<void> {
    const key = REDIS_CHANNELS.workflowSubscription(subscription.workflowId);
    const data = JSON.stringify({
      workflowId: subscription.workflowId,
      nodeId: subscription.nodeId,
      userId: subscription.userId,
      symbols: Array.from(subscription.symbols),
      source: subscription.source,
      eventTypes: subscription.eventTypes,
    });

    try {
      await redisSetBreaker.fire(key, data);
    } catch (error) {
      console.warn(
        `⚠️ [MarketDataSubscriber] Failed to persist subscription to Redis, continuing with in-memory state`
      );
      // Continue - subscription is still active in memory
    }
  }

  /**
   * Get statistics about current subscriptions
   */
  getStats(): {
    totalWorkflows: number;
    totalSymbols: number;
    subscriptions: Array<{
      workflowId: string;
      symbols: string[];
      source?: MarketSource;
    }>;
  } {
    return {
      totalWorkflows: this.subscriptions.size,
      totalSymbols: this.symbolWorkflows.size,
      subscriptions: Array.from(this.subscriptions.values()).map((sub) => ({
        workflowId: sub.workflowId,
        symbols: Array.from(sub.symbols),
        source: sub.source,
      })),
    };
  }

  /**
   * Cleanup resources and prevent memory leaks
   */
  async cleanup(): Promise<void> {
    console.log(`📊 [MarketDataSubscriber] Cleaning up...`);

    // Remove message handler
    if (this.messageHandler) {
      this.redisSub.off("message", this.messageHandler);
      this.messageHandler = null;
    }

    // Unsubscribe from all channels
    await this.redisSub.unsubscribe();

    // Clear memory
    this.subscriptions.clear();
    this.symbolWorkflows.clear();

    this.isInitialized = false;

    console.log(`✅ [MarketDataSubscriber] Cleanup complete`);
  }
}

export default MarketDataSubscriber;
