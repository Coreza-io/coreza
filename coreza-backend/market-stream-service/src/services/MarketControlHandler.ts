/**
 * Phase 5: Market Control Handler
 * Centralized subscription orchestration that listens to Redis control channels
 * and instructs MarketDataGateway instances to connect/subscribe/unsubscribe
 */

import Redis from "ioredis";
import { Mutex } from "async-mutex";
import { createRedisQueuePubSub } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import { MarketDataGateway } from "./MarketDataGateway";
import { MarketDataSubscriber } from "./MarketDataSubscriber";
import CredentialManager from "../utils/credentialManager";
import { redisSetBreaker } from "../utils/redisCircuitBreaker";
import { getSourceMapping } from "../marketGateways";
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
  environment?: string; // For Binance: testnet/live
  assetType?: string; // For Binance: spot/futures
  subscriptionScope?: "global" | "workflow";
  targetWorkflowId?: string;
}

interface SourceState {
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
  private sourceStates = new Map<MarketSource, SourceState>();
  private initialized = false;
  private gatewayMutex = new Mutex(); // Mutex to prevent race conditions

  private constructor() {
    // Create isolated Redis connections for this service
    const { pub, sub } = createRedisQueuePubSub();
    this.redisPub = pub;
    this.redisSub = sub;
  }

  static getInstance(): MarketControlHandler {
    if (!MarketControlHandler.instance) {
      MarketControlHandler.instance = new MarketControlHandler();
    }
    return MarketControlHandler.instance;
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

      // Subscribe to control channels including workflow registration
      await this.redisSub.subscribe(
        REDIS_CHANNELS.controlSubscribe,
        REDIS_CHANNELS.controlUnsubscribe,
        "md:control:register_workflow"
      );
      console.log(
        "✅ [MarketControl] Subscribed to control channels (including workflow registration)"
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
          symbols: msg.symbols,
          workflowId: msg.workflowId,
          nodeId: msg.nodeId,
          userId: msg.userId,
        });

        if (channel === REDIS_CHANNELS.controlSubscribe) {
          await this.handleSubscribe(msg as ControlMessage);
        } else if (channel === REDIS_CHANNELS.controlUnsubscribe) {
          await this.handleUnsubscribe(msg as ControlMessage);
        } else if (channel === "md:control:register_workflow") {
          await this.handleRegisterStreamingWorkflow(msg);
        }
      } catch (error) {
        console.error(
          `❌ [MarketControl] Error processing message on ${channel}:`,
          error
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
  private async handleRegisterStreamingWorkflow(msg: {
    action: string;
    userId: string;
    workflowId: string;
    nodeId: string;
    source?: string;
    filter_symbols?: string[];
    filter_types?: string[];
    subscriptionMode?: "workflow" | "global";
  }): Promise<void> {
    const {
      userId,
      workflowId,
      nodeId,
      source,
      filter_symbols,
      filter_types,
      subscriptionMode = "workflow",
    } = msg;

    try {
      console.log(
        `📡 [MarketControl] Registering streaming workflow ${workflowId} for user ${userId} (source: ${
          source || "all"
        }, mode: ${subscriptionMode})`
      );

      const subscribedSymbols =
        subscriptionMode === "global"
          ? await this.getUserSubscribedSymbols(userId)
          : await this.getWorkflowScopedSymbols(workflowId, source);

      // Get workflow-specific symbols (scoped subscriptions targeting this workflow)

      // Only get global symbols if subscription mode is 'global'
      //const globalSymbols = subscriptionMode === 'global'
      //  ? await this.getUserSubscribedSymbols(userId)
      //  : [];

      // Merge based on subscription mode
      //const allAvailableSymbols = [...new Set([...globalSymbols, ...workflowSpecificSymbols])];

      // Normalize event types for proper filtering
      const normalizedEventTypes = source
        ? this.normalizeEventTypes(source, filter_types)
        : filter_types;

      if (subscribedSymbols.length === 0) {
        console.log(
          `ℹ️ [MarketControl] No active subscriptions for user ${userId}, workflow ${workflowId} will receive data when symbols are subscribed`
        );

        // Still register the workflow with empty symbols - it will receive data when symbols are subscribed later
        const subscriber = MarketDataSubscriber.getInstance();
        await subscriber.subscribe(
          workflowId,
          nodeId,
          userId,
          [], // No symbols yet
          {
            source: source as MarketSource | undefined,
            eventTypes: normalizedEventTypes as any,
          }
        );
        return;
      }

      // Register workflow to receive data for all available symbols
      const subscriber = MarketDataSubscriber.getInstance();

      // If filter_symbols specified, only subscribe to those that are in available subscriptions
      const symbolsToSubscribe =
        filter_symbols && filter_symbols.length > 0
          ? subscribedSymbols.filter((s) =>
              filter_symbols
                .map((fs) => fs.toUpperCase())
                .includes(s.toUpperCase())
            )
          : subscribedSymbols;

      await subscriber.subscribe(
        workflowId,
        nodeId,
        userId,
        symbolsToSubscribe,
        {
          source: source as MarketSource | undefined,
          eventTypes: normalizedEventTypes as any,
        }
      );

      console.log(
        `✅ [MarketControl] Registered streaming workflow ${workflowId} to receive data for ${symbolsToSubscribe.length} symbols ${symbolsToSubscribe}`
      );
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to register streaming workflow ${workflowId}:`,
        error
      );
    }
  }

  /**
   * Get symbols specifically scoped to a workflow
   */
  private async getWorkflowScopedSymbols(
    workflowId: string,
    source?: string
  ): Promise<string[]> {
    const allSymbols = new Set<string>();

    try {
      // If source specified, only check that source
      if (source) {
        const key = `workflow:${workflowId}:subscribed_symbols:${source}`;
        console.log(
          `🔍 [MarketControl] Checking workflow-scoped symbols at key: ${key}`
        );
        const symbols = await this.redisPub.smembers(key);
        console.log(
          `🔍 [MarketControl] Found ${symbols.length} workflow-scoped symbols:`,
          symbols
        );
        symbols.forEach((s) => allSymbols.add(s.toUpperCase()));
      } else {
        // Check all sources for this workflow
        const pattern = `workflow:${workflowId}:subscribed_symbols:*`;
        console.log(
          `🔍 [MarketControl] Checking workflow-scoped symbols with pattern: ${pattern}`
        );
        const keys = await this.redisPub.keys(pattern);
        console.log(
          `🔍 [MarketControl] Found ${keys.length} keys matching pattern`
        );
        for (const key of keys) {
          const symbols = await this.redisPub.smembers(key);
          console.log(
            `🔍 [MarketControl] Key ${key} has ${symbols.length} symbols:`,
            symbols
          );
          symbols.forEach((s) => allSymbols.add(s.toUpperCase()));
        }
      }
    } catch (err) {
      console.error(
        `❌ [MarketControl] Failed to get workflow-scoped symbols for ${workflowId}:`,
        err
      );
    }

    return Array.from(allSymbols);
  }

  /**
   * Get all GLOBAL symbols currently subscribed for a user across all sources
   * Uses pattern matching to find ALL subscription keys (handles _stream suffix variants)
   */
  private async getUserSubscribedSymbols(userId: string): Promise<string[]> {
    const allSymbols = new Set<string>();

    try {
      // Use pattern matching to find ALL subscription keys for this user
      const pattern = `user:${userId}:subscribed_symbols:*`;
      const keys = await this.redisPub.keys(pattern);

      console.log(
        `🔍 [MarketControl] Found ${keys.length} global subscription keys for user ${userId}`
      );

      for (const key of keys) {
        const symbols = await this.redisPub.smembers(key);
        console.log(
          `🔍 [MarketControl] Key ${key} has ${symbols.length} symbols:`,
          symbols
        );
        symbols.forEach((s) => allSymbols.add(s.toUpperCase()));
      }
    } catch (err) {
      console.error(
        `❌ [MarketControl] Failed to get user subscribed symbols:`,
        err
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
    subscriptionScope: "global" | "workflow" = "global",
    targetWorkflowId?: string
  ): Promise<void> {
    try {
      const subscriber = MarketDataSubscriber.getInstance();

      // If workflow-scoped, only update the target workflow
      if (subscriptionScope === "workflow" && targetWorkflowId) {
        console.log(
          `📡 [MarketControl] Updating ONLY target workflow ${targetWorkflowId} with ${newSymbols.length} workflow-scoped symbols`
        );
        await subscriber.addSymbolsToSubscription(targetWorkflowId, newSymbols);
        console.log(
          `✅ [MarketControl] Added ${newSymbols.length} symbols to target workflow ${targetWorkflowId} only`
        );
        return;
      }

      // Global scope: update all active workflows for this user
      const activeWorkflowsKey = `user:${userId}:active_streaming_workflows`;
      const activeWorkflowIds = await this.redisPub.smembers(
        activeWorkflowsKey
      );

      if (activeWorkflowIds.length === 0) {
        console.log(
          `ℹ️ [MarketControl] No active streaming workflows for user ${userId}`
        );
        return;
      }

      console.log(
        `📡 [MarketControl] Updating ${activeWorkflowIds.length} active streaming workflows with new GLOBAL symbols:`,
        newSymbols
      );

      for (const workflowId of activeWorkflowIds) {
        try {
          // Get workflow's filter config from Redis (stored during activation)
          const filterKey = `workflow:${workflowId}:stream_filter`;
          const filterJson = await this.redisPub.get(filterKey);
          const filterConfig = filterJson ? JSON.parse(filterJson) : {};
          const workflowSubscriptionMode =
            filterConfig.subscriptionMode || "workflow";

          if (workflowSubscriptionMode !== "global") {
            console.log(
              `ℹ️ [MarketControl] Workflow ${workflowId} is not in global subscription mode, skipping`
            );
            continue;
          }

          // Apply symbol filter if specified
          let symbolsToAdd = newSymbols;
          const filterSymbols =
            filterConfig.filter_symbols || filterConfig.symbols || [];
          if (filterSymbols.length > 0) {
            const allowedSymbols = filterSymbols.map((s: string) =>
              s.toUpperCase()
            );
            symbolsToAdd = newSymbols.filter((s) =>
              allowedSymbols.includes(s.toUpperCase())
            );

            if (symbolsToAdd.length === 0) {
              console.log(
                `ℹ️ [MarketControl] Workflow ${workflowId} filters exclude new symbols, skipping`
              );
              continue;
            }
          }

          // Add new symbols to existing subscription
          await subscriber.addSymbolsToSubscription(workflowId, symbolsToAdd);

          console.log(
            `✅ [MarketControl] Added ${symbolsToAdd.length} symbols to workflow ${workflowId}`
          );
        } catch (err) {
          console.error(
            `❌ [MarketControl] Failed to update workflow ${workflowId}:`,
            err
          );
        }
      }
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to update active streaming workflows:`,
        error
      );
    }
  }

  /**
   * Map broker-specific stream types to normalized CorezaMarketEvent types
   * This ensures MarketDataSubscriber filters work correctly
   */
  private normalizeEventTypes(
    source: string,
    eventTypes?: string[]
  ): string[] | undefined {
    if (!eventTypes || eventTypes.length === 0) return undefined;

    // Binance-specific mappings
    if (source.includes("binance")) {
      const normalized = eventTypes.map((type) => {
        // All kline types normalize to 'bar'
        if (type.startsWith("kline")) return "bar";
        // bookTicker normalizes to 'quote'
        if (type === "bookTicker") return "quote";
        // ticker (24h) stays as 'ticker'
        if (type === "ticker") return "ticker";
        // trade stays as 'trade'
        return type;
      });
      // Remove duplicates
      return [...new Set(normalized)];
    }

    // Alpaca-specific mappings (plural → singular)
    if (source.includes("alpaca")) {
      const normalized = eventTypes.map((type) => {
        if (type === "trades") return "trade";
        if (type === "quotes") return "quote";
        if (type === "bars") return "bar";
        if (type === "dailyBars") return "daily_bar";
        return type;
      });
      return [...new Set(normalized)];
    }

    return eventTypes;
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
    } = msg;

    try {
      // Acquire mutex to prevent concurrent gateway connections
      await this.gatewayMutex.runExclusive(async () => {
        let state = this.sourceStates.get(source);

        // Connect gateway if needed
        if (!state || !state.gateway.getStats().connected) {
          console.log(`🔌 [MarketControl] Connecting to ${source} gateway...`);
          await this.connectGateway(
            source,
            userId,
            msg.credentialId,
            feed,
            environment,
            assetType
          );
          state = this.sourceStates.get(source)!;
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
        const requestedTypes = eventTypes || ["trades"];

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
            `(types: ${requestedTypes.join(", ")})`
          );
          state.gateway.subscribeSymbols(subscriptionNeeded, eventTypes);

          // Persist to Redis
          await this.persistState(source);
          console.log(
            `✅ [MarketControl] Subscribed to ${subscriptionNeeded.length} symbol(s) on ${source}`
          );

          // Notify active streaming workflows about new symbols (respecting scope)
          const subscriptionScope = msg.subscriptionScope || "global";
          const targetWorkflowId = msg.targetWorkflowId;
          await this.updateActiveStreamingWorkflows(
            userId,
            subscriptionNeeded,
            subscriptionScope,
            targetWorkflowId
          );
        } else {
          console.log(
            `ℹ️ [MarketControl] All symbols with requested types already subscribed on ${source}`
          );
        }

        // Persist subscriptions based on scope
        const subscriptionScope = msg.subscriptionScope || "global";
        const targetWorkflowId = msg.targetWorkflowId;

        if (subscriptionScope === "workflow" && targetWorkflowId) {
          // Workflow-scoped subscription: only target workflow can access
          const workflowSubKey = `workflow:${targetWorkflowId}:subscribed_symbols:${source}`;
          console.log(
            `📝 [MarketControl] Writing workflow-scoped symbols to Redis key: ${workflowSubKey}`
          );
          console.log(
            `📝 [MarketControl] Symbols being written:`,
            symbols.map((s) => s.toUpperCase())
          );
          await this.redisPub.sadd(
            workflowSubKey,
            ...symbols.map((s) => s.toUpperCase())
          );
          console.log(
            `📊 [MarketControl] Persisted ${symbols.length} workflow-scoped subscriptions for ${source} → ${targetWorkflowId}`
          );
        } else {
          // Global subscription: all workflows can access
          const userSubKey = `user:${userId}:subscribed_symbols:${source}`;
          await this.redisPub.sadd(
            userSubKey,
            ...symbols.map((s) => s.toUpperCase())
          );
          console.log(
            `📊 [MarketControl] Persisted ${symbols.length} user-level (global) subscriptions for ${source}`
          );
        }
      });
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to handle subscribe for ${source}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Handle unsubscribe control message
   */
  private async handleUnsubscribe(msg: ControlMessage): Promise<void> {
    const { source, workflowId, symbols } = msg;

    try {
      const state = this.sourceStates.get(source);
      if (!state) {
        console.log(`⚠️ [MarketControl] No gateway state found for ${source}`);
        return;
      }

      // Unregister workflow from MarketDataSubscriber
      if (workflowId) {
        const subscriber = MarketDataSubscriber.getInstance();
        await subscriber.unsubscribe(workflowId);
        console.log(
          `✅ [MarketControl] Unregistered workflow ${workflowId} from MarketDataSubscriber`
        );
      }

      // Remove workflow tracking
      if (workflowId) {
        state.workflowSymbols.delete(workflowId);
        console.log(
          `🗑️ [MarketControl] Removed workflow ${workflowId} from ${source}`
        );
      }

      // Recalculate needed symbols from all remaining workflows
      const neededSymbols = new Set<string>();
      for (const wfSymbols of state.workflowSymbols.values()) {
        wfSymbols.forEach((s) => neededSymbols.add(s.toUpperCase()));
      }

      // Find symbols to unsubscribe
      const toRemove = symbols.filter(
        (s) =>
          !neededSymbols.has(s.toUpperCase()) &&
          state.symbols.has(s.toUpperCase())
      );

      if (toRemove.length > 0) {
        console.log(
          `➖ [MarketControl] Unsubscribing from symbols on ${source}:`,
          toRemove
        );
        toRemove.forEach((s) => state.symbols.delete(s.toUpperCase()));
        state.gateway.unsubscribeSymbols(toRemove);
        await this.persistState(source);
        console.log(
          `✅ [MarketControl] Unsubscribed from ${toRemove.length} symbols on ${source}`
        );
      }

      // Remove user-level subscriptions
      if (symbols.length > 0) {
        const userSubKey = `user:${msg.userId}:subscribed_symbols:${source}`;
        await this.redisPub.srem(
          userSubKey,
          ...symbols.map((s) => s.toUpperCase())
        );
        console.log(
          `📊 [MarketControl] Removed ${symbols.length} user-level subscriptions from ${source}`
        );
      }

      // Disconnect if no more symbols
      if (state.symbols.size === 0) {
        console.log(
          `🔌 [MarketControl] No symbols left, disconnecting ${source} gateway`
        );
        state.gateway.disconnect();
        this.sourceStates.delete(source);
        await this.redisPub.del(REDIS_CHANNELS.gatewayState(source));
        console.log(`✅ [MarketControl] Disconnected ${source} gateway`);
      }
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to handle unsubscribe for ${source}:`,
        error
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
    assetType?: string
  ): Promise<void> {
    try {
      // Map source to credential service type and gateway source
      const { credentialServiceType: serviceType, gatewaySource } =
        getSourceMapping(source);

      let creds: any;

      // Use getCredentials (like brokers) when credentialId is provided
      if (credentialId) {
        const { credentials } = await CredentialManager.getCredentials(
          userId,
          serviceType,
          credentialId
        );

        if (!credentials?.client_json) {
          throw new Error(
            `No credentials found for ${serviceType}/${credentialId}`
          );
        }

        console.log(
          `🔑 [MarketControl] Retrieved credentials for ${serviceType}/${credentialId}`
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
          `🔑 [MarketControl] Retrieved credentials for ${serviceType} (fallback)`
        );
        creds = credentials;
      }

      // Add feed parameter to credentials if provided (for Alpaca)
      if (feed) {
        creds = { ...creds, feed };
        console.log(
          `📡 [MarketControl] Using ${feed.toUpperCase()} feed for ${source}`
        );
      }

      // Add environment and asset type for Binance
      if (environment) {
        creds = { ...creds, environment };
        console.log(
          `🌐 [MarketControl] Using ${environment} environment for ${source}`
        );
      }
      if (assetType) {
        creds = { ...creds, assetType };
        console.log(
          `📊 [MarketControl] Using ${assetType} asset type for ${source}`
        );
      }

      // Get or create gateway instance using mapped gateway source
      const gateway = MarketDataGateway.getInstance(gatewaySource);

      // Connect gateway with credentials
      await gateway.connect(creds);

      // Track state
      this.sourceStates.set(source, {
        gateway,
        connectedUserId: userId,
        credentialId: credentialId || "default",
        symbols: new Set(),
        symbolTypes: new Map(),
        workflowSymbols: new Map(),
      });

      console.log(
        `✅ [MarketControl] Gateway ${source} connected for user ${userId}`
      );
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to connect gateway ${source}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Persist gateway state to Redis (with circuit breaker)
   */
  private async persistState(source: MarketSource): Promise<void> {
    const state = this.sourceStates.get(source);
    if (!state) return;

    const stateData = {
      userId: state.connectedUserId,
      credentialId: state.credentialId,
      symbols: Array.from(state.symbols),
      symbolTypes: Array.from(state.symbolTypes.entries()).map(
        ([symbol, types]) => ({
          symbol,
          types: Array.from(types),
        })
      ),
      workflowSymbols: Array.from(state.workflowSymbols.entries()).map(
        ([wfId, symbols]) => ({
          workflowId: wfId,
          symbols: Array.from(symbols),
        })
      ),
      timestamp: new Date().toISOString(),
    };

    try {
      await redisSetBreaker.fire(
        REDIS_CHANNELS.gatewayState(source),
        JSON.stringify(stateData)
      );

      // Also persist symbols set (no circuit breaker for now, less critical)
      await this.redisPub.sadd(
        REDIS_CHANNELS.gatewaySymbols(source),
        ...state.symbols
      );

      console.log(`💾 [MarketControl] Persisted state for ${source}`);
    } catch (error) {
      console.warn(
        `⚠️ [MarketControl] Failed to persist state for ${source}, continuing with in-memory state`
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

      const sources: MarketSource[] = [
        "alpaca",
        "alpaca_news",
        "binance",
        "dhan",
        "schwab",
      ];
      let restoredCount = 0;

      for (const source of sources) {
        const stateKey = REDIS_CHANNELS.gatewayState(source);
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
              source,
              stateData.userId,
              stateData.credentialId
            );
            const state = this.sourceStates.get(source)!;

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
                  } symbols on ${source} (types: ${types.join(", ")})`
                );
              }
            }

            // Also restore symbols set (for backwards compatibility)
            if (stateData.symbols && Array.isArray(stateData.symbols)) {
              stateData.symbols.forEach((s: string) =>
                state.symbols.add(s.toUpperCase())
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
                    symbols.add(s.toUpperCase())
                  );
                }
                state.workflowSymbols.set(wf.workflowId, symbols);
              });
            }

            restoredCount++;
            console.log(
              `✅ [MarketControl] Restored ${source} gateway with ${state.symbols.size} symbols`
            );
          } catch (error) {
            console.error(
              `❌ [MarketControl] Failed to restore ${source}:`,
              error
            );
          }
        }
      }

      console.log(
        `✅ [MarketControl] Restored ${restoredCount} gateway(s) from Redis`
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

    for (const [source, state] of this.sourceStates.entries()) {
      stats[source] = {
        connected: state.gateway.getStats().connected,
        authenticated: state.gateway.getStats().authenticated,
        userId: state.connectedUserId,
        symbolCount: state.symbols.size,
        symbols: Array.from(state.symbols),
        workflowCount: state.workflowSymbols.size,
        workflows: Array.from(state.workflowSymbols.entries()).map(
          ([wfId, symbols]) => ({
            workflowId: wfId,
            symbolCount: symbols.size,
          })
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

    for (const [source, state] of this.sourceStates.entries()) {
      try {
        state.gateway.disconnect();
        console.log(`✅ [MarketControl] Disconnected ${source} gateway`);
      } catch (error) {
        console.error(
          `❌ [MarketControl] Error disconnecting ${source}:`,
          error
        );
      }
    }

    this.sourceStates.clear();

    await this.redisSub.quit();
    await this.redisPub.quit();
    console.log("✅ [MarketControl] Cleanup complete");
  }
}
