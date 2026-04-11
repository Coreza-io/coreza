/**
 * Phase 5: Market Control Handler
 * Centralized subscription orchestration that listens to Redis control channels
 * and instructs MarketDataGateway instances to connect/subscribe/unsubscribe
 */

import Redis from "ioredis";
import { Mutex } from "async-mutex";
import { createRedisPubSub } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import { MarketDataGateway } from "./MarketDataGateway";
import { MarketDataSubscriber } from "./MarketDataSubscriber";
import CredentialManager from "../utils/credentialManager";
import { redisSetBreaker } from "../utils/redisCircuitBreaker";
import { buildStreamNames, extractSymbol } from "../utils/streamName";
import type { MarketSource } from "../types/marketEvent";

interface ControlMessage {
  action: "subscribe" | "unsubscribe";
  userId: string;
  workflowId: string;
  nodeId?: string;
  symbols: string[];
  source: MarketSource;
  credentialId?: string;
  eventTypes?: string[];
  feed?: string;
  environment?: string; // For Binance: testnet/live
  assetType?: string; // For Binance: spot/futures
  scope: string;
  targetWorkflowId?: string;
  // Raw interval/depth for stream name building (centralized in market-stream-service)
  interval?: string;
  depthLevels?: string;
}

interface SourceState {
  source: MarketSource;
  gateway: MarketDataGateway;
  connectedUserId: string;
  credentialId: string;
  // Single source of truth: native stream names (btcusdt@kline_1m, bars.AAPL)
  streams: Set<string>;
  workflowStreams: Map<string, Set<string>>; // workflowId → streams (for reference counting)
}

export class MarketControlHandler {
  private static instance: MarketControlHandler;
  private redisSub: Redis;
  private redisPub: Redis;
  private sourceStates = new Map<string, SourceState>();
  private initialized = false;
  private gatewayMutex = new Mutex(); // Mutex to prevent race conditions

  private constructor() {
    // Create isolated Redis connections for this service
    const { pub, sub } = createRedisPubSub();
    this.redisPub = pub;
    this.redisSub = sub;
  }

  static getInstance(): MarketControlHandler {
    if (!MarketControlHandler.instance) {
      MarketControlHandler.instance = new MarketControlHandler();
    }
    return MarketControlHandler.instance;
  }

  private getStateKey(userId: string, source: MarketSource): string {
    return `${userId}:${source}`;
  }

  /**
   * Initialize handler: connect to Redis and start listening to control channels
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log("⚠️ [MarketControl] Already initialized");
      return;
    }

    try {
      // Redis connections are already established by factory
      console.log("✅ [MarketControl] Using shared Redis connections");

      // Subscribe to control channels including workflow registration and unregistration
      await this.redisSub.subscribe(
        REDIS_CHANNELS.controlSubscribe,
        REDIS_CHANNELS.controlUnsubscribe,
        REDIS_CHANNELS.controlRegister,
        REDIS_CHANNELS.controlUnregister,
      );
      console.log(
        "✅ [MarketControl] Subscribed to control channels (including workflow registration/unregistration)",
      );

      // Set up message handler
      this.setupControlListeners();

      // Restore active subscriptions from Redis
      await this.restoreFromRedis();

      this.initialized = true;
      console.log("✅ [MarketControl] Market Control Handler initialized");
    } catch (error) {
      console.error("❌ [MarketControl] Failed to initialize:", error);
      throw error;
    }
  }

  /**
   * Set up Redis message listeners for control channels
   */
  private setupControlListeners(): void {
    this.redisSub.on("message", async (channel, message) => {
      try {
        const msg = JSON.parse(message);
        console.log(`📨 [MarketControl] Received message on ${channel}:`, {
          action: msg.action,
          source: msg.source,
          subscriptionMode: msg.subscriptionMode,
          isTestListener: msg.isTestListener,
          workflowId: msg.workflowId,
          nodeId: msg.nodeId,
          userId: msg.userId,
        });

        if (channel === REDIS_CHANNELS.controlSubscribe) {
          await this.handleSubscribe(msg as ControlMessage);
        } else if (channel === REDIS_CHANNELS.controlUnsubscribe) {
          await this.handleUnsubscribe(msg as ControlMessage);
        } else if (channel === REDIS_CHANNELS.controlRegister) {
          await this.handleRegister(msg);
        } else if (channel === REDIS_CHANNELS.controlUnregister) {
          await this.handleUnregister(msg);
        }
      } catch (error) {
        console.error(
          `❌ [MarketControl] Error processing message on ${channel}:`,
          error,
        );
      }
    });

    this.redisSub.on("error", (error) => {
      console.error("❌ [MarketControl] Redis subscription error:", error);
    });
  }

  /**
   * Handle registration of streaming workflows (from workflow activation)
   *
   * Subscription mode controls which symbols the workflow receives:
   * - 'workflow' (default): ONLY symbols specifically scoped to this workflow
   * - 'global': ALL symbols subscribed globally by the user + workflow-specific symbols
   */
  private async handleRegister(msg: {
    action: string;
    userId: string;
    workflowId: string;
    nodeId: string;
    source: string;
    scope: string;
    onlyClosedBars?: boolean;
    isLive?: boolean;
  }): Promise<void> {
    const { userId, workflowId, nodeId, source, scope, onlyClosedBars, isLive } = msg;

    try {
      console.log(
        `📡 [MarketControl] Registering streaming workflow ${workflowId} for user ${userId} (source: ${
          source || "all"
        }, mode: ${scope}, onlyClosedBars: ${onlyClosedBars ?? true}, isLive: ${isLive ?? false}
        )})`,
      );

      const subscriber = MarketDataSubscriber.getInstance();
      // NORMAL WORKFLOW MODE: Get symbols from Redis subscriptions
      const streamToRegister =
        scope === "global"
          ? await this.getUserSubscribedSymbols(userId, source)
          : await this.getWorkflowScopedSymbols(userId, workflowId, source);

      if (streamToRegister.length === 0) {
        console.log(
          `ℹ️ [MarketControl] No active subscriptions for user ${userId}, workflow ${workflowId} will receive data when symbols are subscribed`,
        );
      }

      // Still register the workflow with empty symbols - it will receive data when symbols are subscribed later
      await subscriber.registerWorkflow(
        workflowId,
        nodeId,
        userId,
        streamToRegister,
        source as MarketSource,
        onlyClosedBars,
        isLive,
      );

      console.log(
        `✅ [MarketControl] Registered streaming workflow ${workflowId} to receive data for ${
          streamToRegister.length
        } symbols: ${streamToRegister.join(", ")}`,
      );
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to register streaming workflow ${workflowId}:`,
        error,
      );
    }
  }

  /**
   * Handle unregistration of streaming workflows (from workflow deactivation or test listener cleanup)
   */
  private async handleUnregister(msg: {
    action: string;
    userId: string;
    workflowId: string;
  }): Promise<void> {
    const { userId, workflowId } = msg;

    try {
      console.log(
        `📡 [MarketControl] Unregistering streaming workflow ${workflowId} for user ${userId} (isTestListener: 
        )`,
      );

      const subscriber = MarketDataSubscriber.getInstance();
      await subscriber.unregisterWorkflow(userId, workflowId);

      console.log(
        `✅ [MarketControl] Unregistered streaming workflow ${workflowId}`,
      );
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to unregister streaming workflow ${workflowId}:`,
        error,
      );
    }
  }

  /**
   * Get the companion trading source for a market source.
   * Trading updates are account-wide, so when registering for market data,
   * we also need to discover any trading streams the user subscribed to.
   */
  private getCompanionTradingSource(source: string): string | null {
    if (source === "alpaca_market" || source === "alpaca_crypto") return "alpaca_trading";
    if (source === "binance_market") return "binance_trading";
    return null;
  }

  /**
   * Get symbols specifically scoped to a workflow
   */
  private async getWorkflowScopedSymbols(
    userId: string,
    workflowId: string,
    source?: string,
  ): Promise<string[]> {
    const allStreams = new Set<string>();

    try {
      // If source specified, only check that source
      if (source) {
        const key = `md:user:${userId}:subscription:scope:workflow:${workflowId}:${source}:streams`;
        console.log(
          `🔍 [MarketControl] Checking workflow-scoped symbols at key: ${key}`,
        );
        const streams = await this.redisPub.smembers(key);
        console.log(
          `🔍 [MarketControl] Found ${streams.length} workflow-scoped symbols:`,
          streams,
        );
        streams.forEach((s) => allStreams.add(s));

        // Also check companion trading source (e.g., alpaca_trading alongside alpaca_market)
        const companionSource = this.getCompanionTradingSource(source);
        if (companionSource) {
          const tradingKey = `md:user:${userId}:subscription:scope:workflow:${workflowId}:${companionSource}:streams`;
          console.log(
            `🔍 [MarketControl] Checking companion trading streams at key: ${tradingKey}`,
          );
          const tradingStreams = await this.redisPub.smembers(tradingKey);
          if (tradingStreams.length > 0) {
            console.log(
              `🔍 [MarketControl] Found ${tradingStreams.length} companion trading streams:`,
              tradingStreams,
            );
            tradingStreams.forEach((s) => allStreams.add(s));
          }
        }
      }
    } catch (err) {
      console.error(
        `❌ [MarketControl] Failed to get workflow-scoped symbols for ${workflowId}:`,
        err,
      );
    }

    return Array.from(allStreams);
  }

  /**
   * Get all GLOBAL symbols currently subscribed for a user across all sources
   * Uses pattern matching to find ALL subscription keys (handles _stream suffix variants)
   */
  private async getUserSubscribedSymbols(
    userId: string,
    source: string,
  ): Promise<string[]> {
    const allStream = new Set<string>();

    try {
      // Use pattern matching to find ALL subscription keys for this user
      const key = `md:user:${userId}:subscription:scope:global:${source}:streams`;
      const streams = await this.redisPub.smembers(key);
      streams.forEach((s) => allStream.add(s));

      // Also check companion trading source (e.g., alpaca_trading alongside alpaca_market)
      const companionSource = this.getCompanionTradingSource(source);
      if (companionSource) {
        const tradingKey = `md:user:${userId}:subscription:scope:global:${companionSource}:streams`;
        const tradingStreams = await this.redisPub.smembers(tradingKey);
        if (tradingStreams.length > 0) {
          console.log(
            `🔍 [MarketControl] Found ${tradingStreams.length} companion trading streams (global):`,
            tradingStreams,
          );
          tradingStreams.forEach((s) => allStream.add(s));
        }
      }
    } catch (err) {
      console.error(
        `❌ [MarketControl] Failed to get user subscribed symbols:`,
        err,
      );
    }

    return Array.from(allStream);
  }

  /**
   * Update active streaming workflows for a user with newly subscribed streams
   * This ensures workflows activated BEFORE streams were subscribed still receive data
   *
   * IMPORTANT: Respects subscription scope:
   * - 'workflow' scope: ONLY updates the target workflow
   * - 'global' scope: Updates ALL active streaming workflows for the user
   */
  private async updateActiveStreamingWorkflows(
    userId: string,
    newStreamNames: string[],
    scope: string,
    targetWorkflowId?: string,
  ): Promise<void> {
    try {
      const subscriber = MarketDataSubscriber.getInstance();

      // If workflow-scoped, only update the target workflow AND any test listeners for it
      if (scope === "workflow" && targetWorkflowId) {
        console.log(
          `📡 [MarketControl] Updating ONLY target workflow ${targetWorkflowId} with ${newStreamNames.length} workflow-scoped streams`,
        );
        await subscriber.addStreamsToRegistration(
          targetWorkflowId,
          newStreamNames,
        );

        // Also update any test listeners for this workflow (handles race condition)
        const ListenerPattern = `md:user:${userId}:stream:${targetWorkflowId}:*`;
        try {
          const ListenerKeys = await this.redisPub.keys(ListenerPattern);
          if (ListenerKeys.length > 0) {
            console.log(
              `🧪 [MarketControl] Found ${ListenerKeys.length} test listener(s) for workflow ${targetWorkflowId}`,
            );
            for (const listener of ListenerKeys) {
              const workflowId = listener.split(":")[4];
              await subscriber.addStreamsToRegistration(
                workflowId,
                newStreamNames,
              );
              console.log(
                `🧪 [MarketControl] Updated test listener ${listener} with ${newStreamNames.length} streams`,
              );
            }
          }
        } catch (err) {
          console.warn(
            `⚠️ [MarketControl] Failed to update test listeners for ${targetWorkflowId}:`,
            err,
          );
        }

        console.log(
          `✅ [MarketControl] Added ${newStreamNames.length} streams to target workflow ${targetWorkflowId} only`,
        );
        return;
      }

      // Global scope: update all active workflows for this user
      const activeWorkflowsKey = `md:user:${userId}:active_streaming_workflows`;
      const activeWorkflowIds =
        await this.redisPub.smembers(activeWorkflowsKey);

      if (activeWorkflowIds.length === 0) {
        console.log(
          `ℹ️ [MarketControl] No active streaming workflows for user ${userId}`,
        );
        return;
      }

      console.log(
        `📡 [MarketControl] Updating ${activeWorkflowIds.length} active streaming workflows with new GLOBAL streams:`,
        newStreamNames,
      );

      for (const workflowId of activeWorkflowIds) {
        try {
          // Get workflow's filter config from Redis (stored during activation)
          const filterKey = `md:user:${userId}:workflow:${workflowId}:stream_filter`;
          const filterJson = await this.redisPub.get(filterKey);
          const filterConfig = filterJson ? JSON.parse(filterJson) : {};

          // Apply stream filter if specified
          let streamsToAdd = newStreamNames;

          // Add new streams to existing registration
          await subscriber.addStreamsToRegistration(workflowId, streamsToAdd);

          console.log(
            `✅ [MarketControl] Added ${streamsToAdd.length} streams to workflow ${workflowId}`,
          );
        } catch (err) {
          console.error(
            `❌ [MarketControl] Failed to update workflow ${workflowId}:`,
            err,
          );
        }
      }

      // Also update test listeners for global scope
      // Use user-specific SET for O(1) lookup instead of pattern scanning
      // Key pattern: user:${userId}:stream:active_listeners
      const userListenersKey = `user:${userId}:stream:active_listeners`;
      try {
        const listenerKeys = await this.redisPub.smembers(userListenersKey);

        if (listenerKeys.length > 0) {
          console.log(
            `🔍 [MarketControl] Found ${listenerKeys.length} test listener(s) for user ${userId} to update with global streams`,
          );

          for (const listenerKey of listenerKeys) {
            try {
              const listenerJson = await this.redisPub.get(listenerKey);
              if (!listenerJson) {
                // Listener expired, clean up stale SET entry
                await this.redisPub.srem(userListenersKey, listenerKey);
                continue;
              }

              const listenerData = JSON.parse(listenerJson);

              // Apply filter_symbols if specified
              let streamsToAdd = newStreamNames;
              if (
                listenerData.filterSymbols &&
                listenerData.filterSymbols.length > 0
              ) {
                const allowedStreams = listenerData.filterSymbols.map(
                  (s: string) => s,
                );
                streamsToAdd = newStreamNames.filter((s) =>
                  allowedStreams.includes(s),
                );

                if (streamsToAdd.length === 0) {
                  console.log(
                    `ℹ️ [MarketControl] Test listener ${listenerKey} filters exclude new streams, skipping`,
                  );
                  continue;
                }
              }

              await subscriber.addStreamsToRegistration(
                listenerKey,
                streamsToAdd,
              );
              console.log(
                `🧪 [MarketControl] Updated test listener ${listenerKey} with ${streamsToAdd.length} global streams`,
              );
            } catch (err) {
              console.warn(
                `⚠️ [MarketControl] Failed to update test listener ${listenerKey}:`,
                err,
              );
            }
          }
        }
      } catch (err) {
        console.warn(
          `⚠️ [MarketControl] Failed to get user test listeners for global update:`,
          err,
        );
      }
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to update active streaming workflows:`,
        error,
      );
    }
  }

  /**
   * Handle subscribe control message (with mutex protection)
   *
   * IMPORTANT: Subscribe nodes ONLY manage gateway subscriptions.
   * They do NOT register for data delivery - that's handled by StreamData trigger nodes.
   * Data routing is managed by md:control:register_workflow channel.
   */
  private async handleSubscribe(msg: ControlMessage): Promise<void> {
    const {
      source,
      userId,
      workflowId,
      symbols,
      eventTypes,
      feed,
      environment,
      assetType,
      interval,
      depthLevels,
      scope,
      targetWorkflowId,
    } = msg;

    try {
      // Acquire mutex to prevent concurrent gateway connections
      await this.gatewayMutex.runExclusive(async () => {
        const stateKey = this.getStateKey(userId, source);
        let state = this.sourceStates.get(stateKey);

        // Connect gateway if needed
        if (!state || !state.gateway.getStats().connected) {
          console.log(`🔌 [MarketControl] Connecting to ${source} gateway...`);
          await this.connectGateway(
            source,
            userId,
            msg.credentialId,
            feed,
            environment,
            assetType,
          );
          state = this.sourceStates.get(stateKey)!;
          console.log(`✅ [MarketControl] Connected to ${source} gateway`);
        }

        // Build stream names FIRST (before any tracking)
        const processedEventTypes = this.processEventTypesForStreamNames(
          eventTypes || [],
          source,
          interval,
          depthLevels,
        );

        const requestedStreamNames = buildStreamNames(
          source,
          symbols,
          processedEventTypes,
          interval || "",
        );

        // Check which stream names are NEW (not already in state.streams)
        const newStreamNames = requestedStreamNames.filter(
          (name) => !state.streams.has(name),
        );

        if (newStreamNames.length > 0) {
          console.log(
            `➕ [MarketControl] Subscribing to new streams on ${source}:`,
            newStreamNames.slice(0, 5).join(", ") +
              (newStreamNames.length > 5 ? "..." : ""),
          );

          // Add to tracking
          newStreamNames.forEach((name) => state.streams.add(name));

          // Track workflow streams (for reference counting only, NOT for data routing)
          const currentStream =
            state.workflowStreams.get(workflowId) || new Set();
          newStreamNames.forEach((s) => currentStream.add(s));
          state.workflowStreams.set(workflowId, currentStream);

          // Subscribe gateway with stream names directly
          state.gateway.subscribeStreams(newStreamNames);

          // Persist to Redis
          await this.persistState(userId, source);

          // Store stream names in Redis (:streams key)
          const streamsKey =
            scope === "workflow" && targetWorkflowId
              ? REDIS_CHANNELS.workflowSubscriptionStreams(
                  userId,
                  targetWorkflowId,
                  source,
                )
              : REDIS_CHANNELS.globalSubscriptionStreams(userId, source);

          await this.redisPub.sadd(streamsKey, ...newStreamNames);
          console.log(
            `💾 [MarketControl] Stored ${newStreamNames.length} stream names in ${streamsKey}`,
          );

          // Extract symbols from new stream names for workflow notification
          // const newSymbols = [
          //   ...new Set(
          //     newStreamNames.map((name) => extractSymbol(source, name)),
          //   ),
          // ];

          // Notify active streaming workflows about new symbols (respecting scope)
          await this.updateActiveStreamingWorkflows(
            userId,
            newStreamNames,
            scope,
            targetWorkflowId,
          );

          console.log(
            `✅ [MarketControl] Subscribed to ${newStreamNames.length} stream(s) on ${source}`,
          );
        } else {
          console.log(
            `ℹ️ [MarketControl] All streams already subscribed on ${source}`,
          );
        }
      });
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to handle subscribe for ${source}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Handle unsubscribe control message
   */
  private async handleUnsubscribe(msg: ControlMessage): Promise<void> {
    const {
      userId,
      source,
      workflowId,
      symbols,
      eventTypes,
      interval,
      depthLevels,
      scope,
      targetWorkflowId,
    } = msg;

    try {
      const stateKey = this.getStateKey(userId, source);
      const state = this.sourceStates.get(stateKey);
      if (!state) {
        console.log(
          `⚠️ [MarketControl] No gateway state found for ${source} and user ${userId}`,
        );
        return;
      }

      // Unregister workflow from MarketDataSubscriber
      if (workflowId) {
        const subscriber = MarketDataSubscriber.getInstance();
        await subscriber.unregisterWorkflow(userId, workflowId);
        console.log(
          `✅ [MarketControl] Unregistered workflow ${workflowId} from MarketDataSubscriber`,
        );

        // Remove workflow tracking
        state.workflowStreams.delete(workflowId);
      }

      if (symbols.length > 0) {
        // Build stream names to remove
        const processedEventTypes = this.processEventTypesForStreamNames(
          eventTypes || [],
          source,
          interval,
          depthLevels,
        );

        const streamNamesToRemove = buildStreamNames(
          source,
          symbols,
          processedEventTypes,
          interval || "",
        );

        console.log(
          `➖ [MarketControl] Unsubscribing from streams on ${source}:`,
          streamNamesToRemove.slice(0, 5).join(", ") +
            (streamNamesToRemove.length > 5 ? "..." : ""),
        );

        // Remove from tracking
        streamNamesToRemove.forEach((name) => state.streams.delete(name));

        // Unsubscribe gateway with stream names directly
        state.gateway.unsubscribeStreams(streamNamesToRemove);

        // Remove from Redis
        const streamsKey =
          scope === "workflow" && targetWorkflowId
            ? REDIS_CHANNELS.workflowSubscriptionStreams(
                userId,
                targetWorkflowId,
                source,
              )
            : REDIS_CHANNELS.globalSubscriptionStreams(userId, source);

        if (streamNamesToRemove.length > 0) {
          await this.redisPub.srem(streamsKey, ...streamNamesToRemove);
          console.log(
            `🗑️ [MarketControl] Removed ${streamNamesToRemove.length} stream names from ${streamsKey}`,
          );
        }

        await this.persistState(userId, source);
        console.log(
          `✅ [MarketControl] Unsubscribed from ${streamNamesToRemove.length} stream(s) on ${source}`,
        );
      }

      // Disconnect if no more streams
      if (state.streams.size === 0) {
        console.log(
          `🔌 [MarketControl] No streams left, disconnecting ${source} gateway`,
        );
        state.gateway.disconnect();
        this.sourceStates.delete(stateKey);
        await this.redisPub.del(REDIS_CHANNELS.gatewayState(userId, source));
        console.log(`✅ [MarketControl] Disconnected ${source} gateway`);
      }
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to handle unsubscribe for ${source}:`,
        error,
      );
    }
  }

  /**
   * Process raw event types into format expected by buildStreamNames
   * Handles kline intervals and depth levels for Binance
   */
  private processEventTypesForStreamNames(
    eventTypes: string[],
    source: string,
    interval?: string,
    depthLevels?: string,
  ): string[] {
    if (!source.startsWith("binance")) {
      return eventTypes;
    }

    return eventTypes.map((type) => {
      // Kline with interval: kline -> kline_1m
      if (type === "kline" && interval) {
        return `kline_${interval}`;
      }
      // Depth with levels: depth_levels -> depth20
      if ((type === "depth" || type === "depth_levels") && depthLevels) {
        return `depth${depthLevels}`;
      }
      return type;
    });
  }

  /**
   * Connect to a gateway using credentials
   */
  private async connectGateway(
    source: MarketSource,
    userId: string,
    credentialId?: string,
    feed?: string,
    environment?: string,
    assetType?: string,
  ): Promise<void> {
    try {
      // Map source to credential service type and gateway source
      const baseSource = source.split("_")[0];

      const serviceType = baseSource;
      const gatewaySource = baseSource;

      let creds: any;

      // Use getCredentials (like brokers) when credentialId is provided
      if (credentialId) {
        const { credentials } = await CredentialManager.getCredentials(
          userId,
          serviceType,
          credentialId,
        );

        if (!credentials?.client_json) {
          throw new Error(
            `No credentials found for ${serviceType}/${credentialId}`,
          );
        }

        console.log(
          `🔑 [MarketControl] Retrieved credentials for ${serviceType}/${credentialId}`,
        );
        creds = credentials.client_json;
      } else {
        // Fallback: get most recent credential (backward compatibility)
        const { credentials, error } =
          await CredentialManager.getDecryptedCredentials(userId, serviceType);

        if (error || !credentials) {
          throw new Error(`No credentials found for ${serviceType}: ${error}`);
        }

        console.log(
          `🔑 [MarketControl] Retrieved credentials for ${serviceType} (fallback)`,
        );
        creds = credentials;
      }

      // Add feed parameter to credentials if provided (for Alpaca)
      if (feed) {
        creds = { ...creds, feed };
        console.log(
          `📡 [MarketControl] Using ${feed.toUpperCase()} feed for ${source}`,
        );
      }

      // Add environment and asset type for Binance
      if (environment) {
        creds = { ...creds, environment };
        console.log(
          `🌐 [MarketControl] Using ${environment} environment for ${source}`,
        );
      }
      if (assetType) {
        creds = { ...creds, asset_type: assetType };
        console.log(
          `📊 [MarketControl] Using ${assetType} asset type for ${source}`,
        );
      }

      // Get or create gateway instance using mapped gateway source
      // Pass original source (e.g., 'alpaca_news') for behavior routing
      const gateway = MarketDataGateway.getInstance(
        gatewaySource,
        source,
        this.getStateKey(userId, source),
      );

      // Connect gateway with credentials
      await gateway.connect(creds);

      // Track state with streams (single source of truth)
      this.sourceStates.set(this.getStateKey(userId, source), {
        source,
        gateway,
        connectedUserId: userId,
        credentialId: credentialId || "default",
        streams: new Set(), // Native stream names as single source of truth
        workflowStreams: new Map(),
      });

      console.log(
        `✅ [MarketControl] Gateway ${source} connected for user ${userId}`,
      );
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to connect gateway ${source}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Persist gateway state to Redis (with circuit breaker)
   */
  private async persistState(
    userId: string,
    source: MarketSource,
  ): Promise<void> {
    const state = this.sourceStates.get(this.getStateKey(userId, source));
    if (!state) return;

    const stateData = {
      userId: state.connectedUserId,
      credentialId: state.credentialId,
      // Store native stream names directly
      streams: Array.from(state.streams),
      workflowStreams: Array.from(state.workflowStreams.entries()).map(
        ([wfId, stream]) => ({
          workflowId: wfId,
          streams: Array.from(stream),
        }),
      ),
      timestamp: new Date().toISOString(),
    };

    try {
      await redisSetBreaker.fire(
        REDIS_CHANNELS.gatewayState(userId, source),
        JSON.stringify(stateData),
      );

      console.log(`💾 [MarketControl] Persisted state for ${source}`);
    } catch (error) {
      console.warn(
        `⚠️ [MarketControl] Failed to persist state for ${source}, continuing with in-memory state`,
      );
      // Continue operation - state is still in memory
    }
  }

  /**
   * Restore active subscriptions from Redis on startup
   */
  private async restoreFromRedis(): Promise<void> {
    try {
      console.log("🔄 [MarketControl] Restoring gateway states from Redis...");

      const stateKeys = await this.redisPub.keys("md:gateway:*:*:state");
      let restoredCount = 0;

      for (const stateKey of stateKeys) {
        const match = stateKey.match(/^md:gateway:([^:]+):([^:]+):state$/);
        if (!match) {
          continue;
        }
        const [, userId, source] = match;
        const stateJson = await this.redisPub.get(stateKey);

        if (stateJson) {
          try {
            const stateData = JSON.parse(stateJson);
            const persistedWorkflowStreams = stateData.workflowStreams || [];

            console.log(`📦 [MarketControl] Found saved state for ${source}:`, {
              userId: stateData.userId,
              streamCount: stateData.streams?.length || 0,
              workflowCount: persistedWorkflowStreams.length || 0,
            });

            // Reconnect gateway
            await this.connectGateway(
              source as MarketSource,
              userId,
              stateData.credentialId,
            );
            const state = this.sourceStates.get(
              this.getStateKey(userId, source as MarketSource),
            )!;

            // Restore streams directly - no conversion needed!
            if (stateData.streams && Array.isArray(stateData.streams)) {
              stateData.streams.forEach((s: string) => state.streams.add(s));

              // Subscribe gateway with stored stream names
              state.gateway.subscribeStreams(stateData.streams);

              console.log(
                `🔄 [MarketControl] Restored ${stateData.streams.length} streams on ${source}`,
              );
            }

            // Restore workflow mappings
            if (Array.isArray(persistedWorkflowStreams)) {
              persistedWorkflowStreams.forEach((wf: any) => {
                const streams = new Set<string>();
                const persistedStreams = Array.isArray(wf.streams)
                  ? wf.streams
                  : [];

                persistedStreams.forEach((s: string) =>
                  streams.add(String(s).toLowerCase()),
                );

                state.workflowStreams.set(wf.workflowId, streams);
              });
            }

            restoredCount++;
            console.log(
              `✅ [MarketControl] Restored ${source} gateway with ${state.streams.size} streams`,
            );
          } catch (error) {
            console.error(
              `❌ [MarketControl] Failed to restore ${source}:`,
              error,
            );
          }
        }
      }

      console.log(
        `✅ [MarketControl] Restored ${restoredCount} gateway(s) from Redis`,
      );
    } catch (error) {
      console.error("❌ [MarketControl] Failed to restore from Redis:", error);
    }
  }

  /**
   * Get current statistics for all gateways
   */
  getStats() {
    const stats: Record<string, any> = {};

    for (const [stateKey, state] of this.sourceStates.entries()) {
      stats[stateKey] = {
        connected: state.gateway.getStats().connected,
        authenticated: state.gateway.getStats().authenticated,
        source: state.source,
        userId: state.connectedUserId,
        streamCount: state.streams.size,
        streams: Array.from(state.streams),
        workflowCount: state.workflowStreams.size,
        workflows: Array.from(state.workflowStreams.entries()).map(
          ([wfId, streams]) => ({
            workflowId: wfId,
            streamCount: streams.size,
          }),
        ),
      };
    }

    return {
      initialized: this.initialized,
      gatewayCount: this.sourceStates.size,
      gateways: stats,
    };
  }

  /**
   * Cleanup and disconnect all gateways
   */
  async cleanup(): Promise<void> {
    console.log("🧹 [MarketControl] Cleaning up...");

    for (const [, state] of this.sourceStates.entries()) {
      try {
        state.gateway.disconnect();
        console.log(`✅ [MarketControl] Disconnected ${state.source} gateway`);
      } catch (error) {
        console.error(
          `❌ [MarketControl] Error disconnecting ${state.source}:`,
          error,
        );
      }
    }

    this.sourceStates.clear();

    await this.redisSub.quit();
    await this.redisPub.quit();
    console.log("✅ [MarketControl] Cleanup complete");
  }
}
