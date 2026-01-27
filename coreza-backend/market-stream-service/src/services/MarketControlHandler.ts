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
import { extractSymbol } from "../utils/streamName";
import { buildStreamNames } from "../utils/streamBuilder";
import type { MarketSource } from "../types/marketEvent";

interface ControlMessage {
  action: "subscribe" | "unsubscribe";
  userId: string;
  workflowId?: string;
  nodeId?: string;
  symbols: string[];
  source: MarketSource;
  credentialId?: string;
  eventTypes?: string[];
  feed?: string;
  environment?: string;
  assetType?: string;
  scope: string;
  targetWorkflowId?: string;
  interval?: string;
  depthLevels?: string;
}

interface SourceState {
  source: MarketSource;
  gateway: MarketDataGateway;
  connectedUserId: string;
  credentialId: string;
  symbols: Set<string>;
  symbolTypes: Map<string, Set<string>>; // symbol → event types
  workflowSymbols: Map<string, Set<string>>; // workflowId → symbols
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

  private normalizeEventTypes(
    source: MarketSource,
    eventTypes?: string[],
  ): string[] {
    if (!eventTypes) return [];

    if (source.startsWith("binance")) {
      return eventTypes.map((type) =>
        type === "depth_levels" ? "depth" : type,
      );
    }

    return eventTypes;
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
  }): Promise<void> {
    const { userId, workflowId, nodeId, source, scope, onlyClosedBars } = msg;

    try {
      console.log(
        `📡 [MarketControl] Registering streaming workflow ${workflowId} for user ${userId} (source: ${
          source || "all"
        }, mode: ${scope}, onlyClosedBars: ${onlyClosedBars ?? true}
        )})`,
      );

      const subscriber = MarketDataSubscriber.getInstance();
      // NORMAL WORKFLOW MODE: Get symbols from Redis subscriptions
      const symbolsToRegister =
        scope === "global"
          ? await this.getUserSubscribedSymbols(userId, source)
          : await this.getWorkflowScopedSymbols(userId, workflowId, source);

      if (symbolsToRegister.length === 0) {
        console.log(
          `ℹ️ [MarketControl] No active subscriptions for user ${userId}, workflow ${workflowId} will receive data when symbols are subscribed`,
        );
      }

      // Still register the workflow with empty symbols - it will receive data when symbols are subscribed later
      await subscriber.registerWorkflow(
        workflowId,
        nodeId,
        userId,
        symbolsToRegister,
        source as MarketSource,
        onlyClosedBars,
      );

      console.log(
        `✅ [MarketControl] Registered streaming workflow ${workflowId} to receive data for ${
          symbolsToRegister.length
        } symbols: ${symbolsToRegister.join(", ")}`,
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
   * Get symbols specifically scoped to a workflow
   */
  private async getWorkflowScopedSymbols(
    userId: string,
    workflowId: string,
    source?: string,
  ): Promise<string[]> {
    const allSymbols = new Set<string>();

    try {
      // If source specified, only check that source
      if (source) {
        const key = REDIS_CHANNELS.workflowSubscriptionStreams(
          userId,
          workflowId,
          source,
        );
        console.log(
          `🔍 [MarketControl] Checking workflow-scoped streams at key: ${key}`,
        );
        const streams = await this.redisPub.smembers(key);
        console.log(
          `🔍 [MarketControl] Found ${streams.length} workflow-scoped streams:`,
          streams,
        );
        streams.forEach((streamName) =>
          allSymbols.add(extractSymbol(source, streamName)),
        );
      }
    } catch (err) {
      console.error(
        `❌ [MarketControl] Failed to get workflow-scoped symbols for ${workflowId}:`,
        err,
      );
    }

    return Array.from(allSymbols);
  }

  /**
   * Get all GLOBAL symbols currently subscribed for a user across all sources
   * Reads native stream names from the streams key and extracts symbols.
   */
  private async getUserSubscribedSymbols(
    userId: string,
    source: string,
  ): Promise<string[]> {
    const allSymbols = new Set<string>();

    try {
      const key = REDIS_CHANNELS.globalSubscriptionStreams(userId, source);
      const streams = await this.redisPub.smembers(key);

      streams.forEach((streamName) =>
        allSymbols.add(extractSymbol(source, streamName)),
      );
    } catch (err) {
      console.error(
        `❌ [MarketControl] Failed to get user subscribed symbols:`,
        err,
      );
    }

    return Array.from(allSymbols);
  }

  /**
   * Update active streaming workflows for a user with newly subscribed symbols
   * This ensures workflows activated BEFORE symbols were subscribed still receive data
   *
   * IMPORTANT: Respects subscription scope:
   * - 'workflow' scope: ONLY updates the target workflow
   * - 'global' scope: Updates ALL active streaming workflows for the user
   */
  private async updateActiveStreamingWorkflows(
    userId: string,
    newSymbols: string[],
    scope: string,
    targetWorkflowId?: string,
  ): Promise<void> {
    try {
      const subscriber = MarketDataSubscriber.getInstance();

      // If workflow-scoped, only update the target workflow AND any test listeners for it
      if (scope === "workflow" && targetWorkflowId) {
        console.log(
          `📡 [MarketControl] Updating ONLY target workflow ${targetWorkflowId} with ${newSymbols.length} workflow-scoped symbols`,
        );
        await subscriber.addSymbolsToRegistration(targetWorkflowId, newSymbols);

        // Also update any test listeners for this workflow (handles race condition)
        const ListenerPattern = `md:user:${userId}:stream:${targetWorkflowId}:*`;
        try {
          const ListenerKeys = await this.redisPub.keys(ListenerPattern);
          if (ListenerKeys.length > 0) {
            console.log(
              `🧪 [MarketControl] Found ${ListenerKeys.length} test listener(s) for workflow ${targetWorkflowId}`,
            );
            for (const testKey of ListenerKeys) {
              await subscriber.addSymbolsToRegistration(testKey, newSymbols);
              console.log(
                `🧪 [MarketControl] Updated test listener ${testKey} with ${newSymbols.length} symbols`,
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
          `✅ [MarketControl] Added ${newSymbols.length} symbols to target workflow ${targetWorkflowId} only`,
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
        `📡 [MarketControl] Updating ${activeWorkflowIds.length} active streaming workflows with new GLOBAL symbols:`,
        newSymbols,
      );

      for (const workflowId of activeWorkflowIds) {
        try {
          // Get workflow's filter config from Redis (stored during activation)
          const filterKey = `md:user:${userId}:workflow:${workflowId}:stream_filter`;
          const filterJson = await this.redisPub.get(filterKey);
          const filterConfig = filterJson ? JSON.parse(filterJson) : {};

          // Apply symbol filter if specified
          let symbolsToAdd = newSymbols;
          if (
            filterConfig.filter_symbols &&
            filterConfig.filter_symbols.length > 0
          ) {
            const allowedSymbols = filterConfig.filter_symbols.map(
              (s: string) => s.toUpperCase(),
            );
            symbolsToAdd = newSymbols.filter((s) =>
              allowedSymbols.includes(s.toUpperCase()),
            );

            if (symbolsToAdd.length === 0) {
              console.log(
                `ℹ️ [MarketControl] Workflow ${workflowId} filters exclude new symbols, skipping`,
              );
              continue;
            }
          }

          // Add new symbols to existing subscription
          await subscriber.addSymbolsToRegistration(workflowId, symbolsToAdd);

          console.log(
            `✅ [MarketControl] Added ${symbolsToAdd.length} symbols to workflow ${workflowId}`,
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
      const userTestListenersKey = `user:${userId}:stream:active_listeners`;
      try {
        const testListenerKeys =
          await this.redisPub.smembers(userTestListenersKey);

        if (testListenerKeys.length > 0) {
          console.log(
            `🔍 [MarketControl] Found ${testListenerKeys.length} test listener(s) for user ${userId} to update with global symbols`,
          );

          for (const testKey of testListenerKeys) {
            try {
              const listenerJson = await this.redisPub.get(testKey);
              if (!listenerJson) {
                // Listener expired, clean up stale SET entry
                await this.redisPub.srem(userTestListenersKey, testKey);
                continue;
              }

              const listenerData = JSON.parse(listenerJson);

              // Apply filter_symbols if specified
              let symbolsToAdd = newSymbols;
              if (
                listenerData.filterSymbols &&
                listenerData.filterSymbols.length > 0
              ) {
                const allowedSymbols = listenerData.filterSymbols.map(
                  (s: string) => s.toUpperCase(),
                );
                symbolsToAdd = newSymbols.filter((s) =>
                  allowedSymbols.includes(s.toUpperCase()),
                );

                if (symbolsToAdd.length === 0) {
                  console.log(
                    `ℹ️ [MarketControl] Test listener ${testKey} filters exclude new symbols, skipping`,
                  );
                  continue;
                }
              }

              await subscriber.addSymbolsToRegistration(testKey, symbolsToAdd);
              console.log(
                `🧪 [MarketControl] Updated test listener ${testKey} with ${symbolsToAdd.length} global symbols`,
              );
            } catch (err) {
              console.warn(
                `⚠️ [MarketControl] Failed to update test listener ${testKey}:`,
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
      nodeId,
      symbols,
      eventTypes,
      feed,
      environment,
      assetType,
      scope,
      targetWorkflowId,
      interval,
      depthLevels,
    } = msg;
    const normalizedEventTypes = this.normalizeEventTypes(source, eventTypes);
    const subscribeOptions = { klineInterval: interval, depthLevels };

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

        // Track workflow symbols (for reference counting only, NOT for data routing)
        if (workflowId) {
          const currentSymbols =
            state.workflowSymbols.get(workflowId) || new Set();
          symbols.forEach((s) => currentSymbols.add(s.toUpperCase()));
          state.workflowSymbols.set(workflowId, currentSymbols);
        }

        // NOTE: We do NOT register with MarketDataSubscriber here anymore
        // Subscribe nodes only manage gateway connections
        // StreamData trigger nodes register via md:control:register_workflow channel
        // This ensures data flows to the correct StreamData nodes, not Subscribe nodes

        // Check if any symbols need new event types subscribed
        const subscriptionNeeded: string[] = [];
        const requestedTypes = normalizedEventTypes;

        for (const symbol of symbols) {
          const upperSymbol = symbol.toUpperCase();
          const existingTypes = state.symbolTypes.get(upperSymbol) || new Set();

          // Check if any requested type is new for this symbol
          const hasNewTypes = requestedTypes.some((t) => !existingTypes.has(t));

          if (!state.symbols.has(upperSymbol) || hasNewTypes) {
            subscriptionNeeded.push(upperSymbol);
            // Add all requested types to tracking
            requestedTypes.forEach((t) => existingTypes.add(t));
            state.symbolTypes.set(upperSymbol, existingTypes);
            state.symbols.add(upperSymbol);
          }
        }

        if (subscriptionNeeded.length > 0) {
          console.log(
            `➕ [MarketControl] Subscribing to symbols with new types on ${source}:`,
            subscriptionNeeded,
            `(types: ${requestedTypes.join(", ")})`,
          );
          state.gateway.subscribeSymbols(
            subscriptionNeeded,
            normalizedEventTypes,
            subscribeOptions,
          );

          // Persist to Redis
          await this.persistState(userId, source);
          console.log(
            `✅ [MarketControl] Subscribed to ${subscriptionNeeded.length} symbol(s) on ${source}`,
          );

          // Notify active streaming workflows about new symbols (respecting scope)
          await this.updateActiveStreamingWorkflows(
            userId,
            subscriptionNeeded,
            scope,
            targetWorkflowId,
          );
        } else {
          console.log(
            `ℹ️ [MarketControl] All symbols with requested types already subscribed on ${source}`,
          );
        }

        const streamNames = buildStreamNames(
          source,
          symbols,
          normalizedEventTypes,
          { interval, depthLevels },
        );
        const streamsKey =
          scope === "workflow" && targetWorkflowId
            ? REDIS_CHANNELS.workflowSubscriptionStreams(
                userId,
                targetWorkflowId,
                source,
              )
            : REDIS_CHANNELS.globalSubscriptionStreams(userId, source);

        if (streamNames.length > 0) {
          await this.redisPub.sadd(streamsKey, ...streamNames);
          console.log(
            `💾 [MarketControl] Stored ${streamNames.length} stream names:`,
            streamNames.slice(0, 3).join(", ") +
              (streamNames.length > 3 ? "..." : ""),
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
      scope,
      targetWorkflowId,
      interval,
      depthLevels,
    } = msg;
    const normalizedEventTypes = this.normalizeEventTypes(source, eventTypes);
    const subscribeOptions = { klineInterval: interval, depthLevels };

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
        state.workflowSymbols.delete(workflowId);
      }

      if (symbols.length > 0) {
        console.log(
          `➖ [MarketControl] Unsubscribing from symbols on ${source}:`,
          symbols,
        );
        symbols.forEach((s) => state.symbols.delete(s.toUpperCase()));
        state.gateway.unsubscribeSymbols(
          symbols,
          normalizedEventTypes,
          subscribeOptions,
        );
        await this.persistState(userId, source);
        console.log(
          `✅ [MarketControl] Unsubscribed from ${symbols.length} symbols on ${source}`,
        );
      }

      if (symbols.length > 0) {
        const streamNames = buildStreamNames(
          source,
          symbols,
          normalizedEventTypes,
          { interval, depthLevels },
        );
        const streamsKey =
          scope === "workflow" && targetWorkflowId
            ? REDIS_CHANNELS.workflowSubscriptionStreams(
                userId,
                targetWorkflowId,
                source,
              )
            : REDIS_CHANNELS.globalSubscriptionStreams(userId, source);

        if (streamNames.length > 0) {
          await this.redisPub.srem(streamsKey, ...streamNames);
          console.log(
            `🗑️ [MarketControl] Removed ${streamNames.length} stream names from Redis`,
          );
        }
      }

      // Disconnect if no more symbols
      if (state.symbols.size === 0) {
        console.log(
          `🔌 [MarketControl] No symbols left, disconnecting ${source} gateway`,
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
        creds = { ...creds, assetType };
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

      // Track state
      this.sourceStates.set(this.getStateKey(userId, source), {
        source,
        gateway,
        connectedUserId: userId,
        credentialId: credentialId || "default",
        symbols: new Set(),
        symbolTypes: new Map(),
        workflowSymbols: new Map(),
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
      symbols: Array.from(state.symbols),
      symbolTypes: Array.from(state.symbolTypes.entries()).map(
        ([symbol, types]) => ({
          symbol,
          types: Array.from(types),
        }),
      ),
      workflowSymbols: Array.from(state.workflowSymbols.entries()).map(
        ([wfId, symbols]) => ({
          workflowId: wfId,
          symbols: Array.from(symbols),
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
            console.log(`📦 [MarketControl] Found saved state for ${source}:`, {
              userId: stateData.userId,
              symbolCount: stateData.symbols?.length || 0,
              workflowCount: stateData.workflowSymbols?.length || 0,
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

            // Restore symbol types first
            if (stateData.symbolTypes && Array.isArray(stateData.symbolTypes)) {
              stateData.symbolTypes.forEach((entry: any) => {
                const types = new Set<string>();
                if (entry.types && Array.isArray(entry.types)) {
                  entry.types.forEach((t: string) => types.add(t));
                }
                state.symbolTypes.set(entry.symbol.toUpperCase(), types);
              });

              // Group symbols by their types for efficient subscription
              const typeGroups = new Map<string, string[]>();

              stateData.symbolTypes.forEach((entry: any) => {
                const types =
                  entry.types && Array.isArray(entry.types)
                    ? entry.types
                    : ["trades"];
                const typeKey = types.sort().join(",");
                if (!typeGroups.has(typeKey)) typeGroups.set(typeKey, []);
                typeGroups.get(typeKey)!.push(entry.symbol.toUpperCase());
              });

              // Subscribe each group with proper types
              for (const [typeKey, symbols] of typeGroups) {
                const types = typeKey.split(",");
                state.gateway.subscribeSymbols(symbols, types);
                console.log(
                  `🔄 [MarketControl] Restored ${
                    symbols.length
                  } symbols on ${source} (types: ${types.join(", ")})`,
                );
              }
            }

            // Also restore symbols set (for backwards compatibility)
            if (stateData.symbols && Array.isArray(stateData.symbols)) {
              stateData.symbols.forEach((s: string) =>
                state.symbols.add(s.toUpperCase()),
              );
            }

            // Restore workflow mappings
            if (
              stateData.workflowSymbols &&
              Array.isArray(stateData.workflowSymbols)
            ) {
              stateData.workflowSymbols.forEach((wf: any) => {
                const symbols = new Set<string>();
                if (wf.symbols && Array.isArray(wf.symbols)) {
                  wf.symbols.forEach((s: string) =>
                    symbols.add(s.toUpperCase()),
                  );
                }
                state.workflowSymbols.set(wf.workflowId, symbols);
              });
            }

            restoredCount++;
            console.log(
              `✅ [MarketControl] Restored ${source} gateway with ${state.symbols.size} symbols`,
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
        symbolCount: state.symbols.size,
        symbols: Array.from(state.symbols),
        workflowCount: state.workflowSymbols.size,
        workflows: Array.from(state.workflowSymbols.entries()).map(
          ([wfId, symbols]) => ({
            workflowId: wfId,
            symbolCount: symbols.size,
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
