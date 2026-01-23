/**
 * RedisPubSubSubscriber
 * Manages Redis Pub/Sub subscriptions for workflows and triggers workflow execution
 * when messages arrive on subscribed channels/patterns
 */

import Redis from "ioredis";
import { createRedisPubSub } from "../config/redis";
import logger from "../utils/logger";
import { bullMqJobQueue } from "./jobQueueManager";
import { WorkflowJobData } from "./queueInterface";
import { v4 as uuidv4 } from "uuid";
import WorkflowCache from "./WorkflowCache";

interface Subscription {
  workflowId: string;
  nodeId: string;
  userId: string;
  type: "channel" | "pattern";
  channels: string[];
}

export class RedisPubSubSubscriber {
  private static instance: RedisPubSubSubscriber;
  private redisSub: Redis | null = null;
  private redisPub: Redis | null = null;
  private subscriptions = new Map<string, Subscription>(); // workflowId -> subscription
  private channelWorkflows = new Map<string, Set<string>>(); // channel -> workflowIds
  private initialized = false;

  private constructor() {
    // Lazy initialization - don't create Redis connections here
  }

  static getInstance(): RedisPubSubSubscriber {
    if (!RedisPubSubSubscriber.instance) {
      RedisPubSubSubscriber.instance = new RedisPubSubSubscriber();
    }
    return RedisPubSubSubscriber.instance;
  }

  private ensureRedisConnections(): { pub: Redis; sub: Redis } {
    if (!this.redisSub || !this.redisPub) {
      const { pub, sub } = createRedisPubSub();
      this.redisPub = pub;
      this.redisSub = sub;
    }
    return { pub: this.redisPub, sub: this.redisSub };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn("RedisPubSubSubscriber already initialized");
      return;
    }

    try {
      // Ensure Redis connections exist
      this.ensureRedisConnections();

      // Set up message handlers
      this.setupMessageHandlers();

      // Restore subscriptions from Redis persistence
      await this.restoreSubscriptions();

      this.initialized = true;
      logger.info("✅ RedisPubSubSubscriber initialized");
    } catch (error) {
      logger.error(
        { err: error },
        "Failed to initialize RedisPubSubSubscriber",
      );
      throw error;
    }
  }

  private setupMessageHandlers(): void {
    const { sub } = this.ensureRedisConnections();

    // Handle messages from exact channels (SUBSCRIBE)
    sub.on("message", async (channel, message) => {
      await this.handleMessage(channel, message, "channel");
    });

    // Handle messages from pattern subscriptions (PSUBSCRIBE)
    sub.on("pmessage", async (pattern, channel, message) => {
      await this.handleMessage(channel, message, "pattern", pattern);
    });

    sub.on("error", (error) => {
      logger.error({ err: error }, "Redis subscription error");
    });
  }

  private async handleMessage(
    channel: string,
    message: string,
    type: "channel" | "pattern",
    pattern?: string,
  ): Promise<void> {
    try {
      // Find workflows subscribed to this channel
      const workflowIds = this.channelWorkflows.get(channel) || new Set();

      logger.debug(
        { channel, pattern, workflowCount: workflowIds.size },
        "Received Redis message",
      );

      for (const workflowId of workflowIds) {
        const subscription = this.subscriptions.get(workflowId);
        if (!subscription) continue;

        // Parse message (try JSON, fallback to string)
        let parsedMessage: any;
        try {
          parsedMessage = JSON.parse(message);
        } catch {
          parsedMessage = message;
        }

        // Trigger workflow execution
        const payload = {
          channel,
          pattern: pattern || null,
          message: parsedMessage,
          timestamp: new Date().toISOString(),
          subscriptionType: type,
        };

        logger.info(
          {
            workflowId,
            nodeId: subscription.nodeId,
            channel,
            pattern,
          },
          "Triggering workflow from Redis message",
        );

        // Fetch workflow definition from cache
        const workflowDef =
          await WorkflowCache.getInstance().getWorkflow(workflowId);
        if (!workflowDef) {
          logger.warn(
            { workflowId },
            "Workflow definition not found, skipping execution",
          );
          continue;
        }

        // Queue workflow execution with proper WorkflowJobData structure
        const jobData: WorkflowJobData = {
          runId: uuidv4(),
          workflowId,
          userId: subscription.userId,
          nodes: workflowDef.nodes || [],
          edges: workflowDef.edges || [],
          trigger: "redis_pubsub",
          initialInput: payload,
        };

        await bullMqJobQueue.addWorkflowExecution(jobData);
      }
    } catch (error) {
      logger.error({ err: error, channel }, "Error handling Redis message");
    }
  }

  async subscribe(
    workflowId: string,
    nodeId: string,
    userId: string,
    channels: string[],
    type: "channel" | "pattern" = "channel",
  ): Promise<void> {
    const { pub, sub } = this.ensureRedisConnections();

    try {
      // Store subscription
      const subscription: Subscription = {
        workflowId,
        nodeId,
        userId,
        type,
        channels: channels.map((c) => c.trim()),
      };

      this.subscriptions.set(workflowId, subscription);

      // Subscribe to channels/patterns
      for (const channel of subscription.channels) {
        // Track workflow for this channel
        if (!this.channelWorkflows.has(channel)) {
          this.channelWorkflows.set(channel, new Set());
        }
        this.channelWorkflows.get(channel)!.add(workflowId);

        // Subscribe to Redis
        if (type === "pattern") {
          await sub.psubscribe(channel);
          logger.info(
            { workflowId, pattern: channel },
            "Subscribed to Redis pattern",
          );
        } else {
          await sub.subscribe(channel);
          logger.info({ workflowId, channel }, "Subscribed to Redis channel");
        }
      }

      // Persist subscription
      await this.persistSubscription(workflowId, subscription);

      logger.info(
        {
          workflowId,
          nodeId,
          channels: subscription.channels,
          type,
        },
        "Redis Pub/Sub subscription created",
      );
    } catch (error) {
      logger.error(
        { err: error, workflowId },
        "Failed to create Redis Pub/Sub subscription",
      );
      throw error;
    }
  }

  async unsubscribe(workflowId: string): Promise<void> {
    const { pub, sub } = this.ensureRedisConnections();

    try {
      const subscription = this.subscriptions.get(workflowId);
      if (!subscription) {
        logger.warn({ workflowId }, "No subscription found to unsubscribe");
        return;
      }

      // Remove workflow from channel mappings
      for (const channel of subscription.channels) {
        const workflows = this.channelWorkflows.get(channel);
        if (workflows) {
          workflows.delete(workflowId);

          // If no more workflows for this channel, unsubscribe from Redis
          if (workflows.size === 0) {
            if (subscription.type === "pattern") {
              await sub.punsubscribe(channel);
              logger.info(
                { pattern: channel },
                "Unsubscribed from Redis pattern (no more workflows)",
              );
            } else {
              await sub.unsubscribe(channel);
              logger.info(
                { channel },
                "Unsubscribed from Redis channel (no more workflows)",
              );
            }
            this.channelWorkflows.delete(channel);
          }
        }
      }

      // Remove subscription
      this.subscriptions.delete(workflowId);

      // Remove from Redis persistence
      await pub.del(`redis:sub:${workflowId}`);

      logger.info({ workflowId }, "Redis Pub/Sub subscription removed");
    } catch (error) {
      logger.error(
        { err: error, workflowId },
        "Failed to remove Redis Pub/Sub subscription",
      );
    }
  }

  private async persistSubscription(
    workflowId: string,
    subscription: Subscription,
  ): Promise<void> {
    const { pub } = this.ensureRedisConnections();

    try {
      await pub.set(
        `redis:sub:${workflowId}`,
        JSON.stringify(subscription),
        "EX",
        86400 * 7, // 7 days TTL
      );
    } catch (error) {
      logger.warn(
        { err: error, workflowId },
        "Failed to persist subscription to Redis",
      );
    }
  }

  private async restoreSubscriptions(): Promise<void> {
    const { pub } = this.ensureRedisConnections();

    try {
      logger.info("Restoring Redis Pub/Sub subscriptions...");

      // Scan for subscription keys
      const keys = await pub.keys("redis:sub:*");

      let restoredCount = 0;
      for (const key of keys) {
        try {
          const data = await pub.get(key);
          if (!data) continue;

          const subscription: Subscription = JSON.parse(data);

          // Restore subscription
          await this.subscribe(
            subscription.workflowId,
            subscription.nodeId,
            subscription.userId,
            subscription.channels,
            subscription.type,
          );

          restoredCount++;
        } catch (error) {
          logger.error({ err: error, key }, "Failed to restore subscription");
        }
      }

      logger.info(
        { count: restoredCount },
        "Restored Redis Pub/Sub subscriptions",
      );
    } catch (error) {
      logger.error(
        { err: error },
        "Failed to restore Redis Pub/Sub subscriptions",
      );
    }
  }

  getStats() {
    return {
      totalSubscriptions: this.subscriptions.size,
      totalChannels: this.channelWorkflows.size,
      subscriptions: Array.from(this.subscriptions.entries()).map(
        ([wfId, sub]) => ({
          workflowId: wfId,
          nodeId: sub.nodeId,
          userId: sub.userId,
          type: sub.type,
          channels: sub.channels,
        }),
      ),
    };
  }

  async shutdown(): Promise<void> {
    try {
      logger.info("Shutting down RedisPubSubSubscriber...");

      if (this.redisSub) {
        // Unsubscribe from all
        await this.redisSub.unsubscribe();
        await this.redisSub.punsubscribe();
        await this.redisSub.quit();
      }

      if (this.redisPub) {
        await this.redisPub.quit();
      }

      this.initialized = false;
      logger.info("RedisPubSubSubscriber shut down");
    } catch (error) {
      logger.error({ err: error }, "Error shutting down RedisPubSubSubscriber");
    }
  }
}
