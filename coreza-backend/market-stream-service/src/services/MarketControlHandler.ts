/**
 * Phase 5: Market Control Handler
 * Centralized subscription orchestration that listens to Redis control channels
 * and instructs MarketDataGateway instances to connect/subscribe/unsubscribe
 */

import Redis from 'ioredis';
import { Mutex } from 'async-mutex';
import { createRedisPubSub } from '../config/redis';
import { REDIS_CHANNELS } from '../config/redisChannels';
import { MarketDataGateway } from './MarketDataGateway';
import { MarketDataSubscriber } from './MarketDataSubscriber';
import CredentialManager from '../utils/credentialManager';
import { redisSetBreaker } from '../utils/redisCircuitBreaker';
import { getWebSocketConfig } from '../config/websockets';
import type { MarketSource } from '../types/marketEvent';

interface ControlMessage {
  action: 'subscribe' | 'unsubscribe';
  userId: string;
  workflowId?: string;
  nodeId?: string;
  symbols: string[];
  source: MarketSource;
  credentialId?: string;
  eventTypes?: string[];
  feed?: string;
  environment?: string;  // For Binance: testnet/live
  assetType?: string;    // For Binance: spot/futures
}

interface SourceState {
  gateway: MarketDataGateway;
  connectedUserId: string;
  credentialId: string;
  symbols: Set<string>;
  symbolTypes: Map<string, Set<string>>; // symbol → event types
  workflowSymbols: Map<string, Set<string>>; // workflowId → symbols for proper lifecycle management
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

  /**
   * Initialize handler: connect to Redis and start listening to control channels
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('⚠️ [MarketControl] Already initialized');
      return;
    }

    try {
      // Redis connections are already established by factory
      console.log('✅ [MarketControl] Using shared Redis connections');

      // Subscribe to control channels including workflow registration
      await this.redisSub.subscribe(
        REDIS_CHANNELS.controlSubscribe,
        REDIS_CHANNELS.controlUnsubscribe,
        'md:control:register_workflow'
      );
      console.log('✅ [MarketControl] Subscribed to control channels (including workflow registration)');

      // Set up message handler
      this.setupControlListeners();

      // Restore active subscriptions from Redis
      await this.restoreFromRedis();

      this.initialized = true;
      console.log('✅ [MarketControl] Market Control Handler initialized');
    } catch (error) {
      console.error('❌ [MarketControl] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Set up Redis message listeners for control channels
   */
  private setupControlListeners(): void {
    this.redisSub.on('message', async (channel, message) => {
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
        } else if (channel === 'md:control:register_workflow') {
          await this.handleRegisterStreamingWorkflow(msg);
        }
      } catch (error) {
        console.error(`❌ [MarketControl] Error processing message on ${channel}:`, error);
      }
    });

    this.redisSub.on('error', (error) => {
      console.error('❌ [MarketControl] Redis subscription error:', error);
    });
  }

  /**
   * Handle registration of streaming workflows (from workflow activation)
   * These workflows receive data for ALL symbols subscribed by the user
   */
  private async handleRegisterStreamingWorkflow(msg: {
    action: string;
    userId: string;
    workflowId: string;
    nodeId: string;
    filter_symbols?: string[];
    filter_types?: string[];
  }): Promise<void> {
    const { userId, workflowId, nodeId, filter_symbols, filter_types } = msg;

    try {
      console.log(`📡 [MarketControl] Registering streaming workflow ${workflowId} for user ${userId}`);

      // Get all symbols currently subscribed for this user across all sources
      const userSymbols = await this.getUserSubscribedSymbols(userId);

      if (userSymbols.length === 0) {
        console.log(`ℹ️ [MarketControl] No active subscriptions for user ${userId}, workflow ${workflowId} will receive data when symbols are subscribed`);
        
        // Still register the workflow with empty symbols - it will receive data when symbols are subscribed later
        const subscriber = MarketDataSubscriber.getInstance();
        await subscriber.subscribe(
          workflowId,
          nodeId,
          userId,
          [], // No symbols yet
          {
            eventTypes: filter_types as any,
          }
        );
        return;
      }

      // Register workflow to receive data for all user's subscribed symbols
      const subscriber = MarketDataSubscriber.getInstance();
      
      // If filter_symbols specified, only subscribe to those that are in user's subscriptions
      const symbolsToSubscribe = filter_symbols && filter_symbols.length > 0
        ? userSymbols.filter(s => filter_symbols.map(fs => fs.toUpperCase()).includes(s.toUpperCase()))
        : userSymbols;

      await subscriber.subscribe(
        workflowId,
        nodeId,
        userId,
        symbolsToSubscribe,
        {
          eventTypes: filter_types as any,
        }
      );

      console.log(`✅ [MarketControl] Registered streaming workflow ${workflowId} to receive data for ${symbolsToSubscribe.length} symbols`);
    } catch (error) {
      console.error(`❌ [MarketControl] Failed to register streaming workflow ${workflowId}:`, error);
    }
  }

  /**
   * Get all symbols currently subscribed for a user across all sources
   */
  private async getUserSubscribedSymbols(userId: string): Promise<string[]> {
    const allSymbols = new Set<string>();

    // Check all gateway states for this user's subscriptions
    for (const [source, state] of this.sourceStates) {
      if (state.connectedUserId === userId) {
        state.symbols.forEach(s => allSymbols.add(s));
      }
    }

    // Also check Redis for persisted subscriptions
    const sources: MarketSource[] = ['alpaca', 'alpaca_news', 'binance', 'dhan', 'schwab'];
    for (const source of sources) {
      const stateKey = REDIS_CHANNELS.gatewayState(source);
      try {
        const stateJson = await this.redisPub.get(stateKey);
        if (stateJson) {
          const stateData = JSON.parse(stateJson);
          if (stateData.userId === userId && stateData.symbols) {
            stateData.symbols.forEach((s: string) => allSymbols.add(s.toUpperCase()));
          }
        }
      } catch (err) {
        // Continue with other sources
      }
    }

    return Array.from(allSymbols);
  }

  /**
   * Update all active streaming workflows for a user with newly subscribed symbols
   * This ensures workflows activated BEFORE symbols were subscribed still receive data
   */
  private async updateActiveStreamingWorkflows(
    userId: string,
    newSymbols: string[]
  ): Promise<void> {
    try {
      // Get all active streaming workflows for this user from Redis
      const activeWorkflowsKey = `user:${userId}:active_streaming_workflows`;
      const activeWorkflowIds = await this.redisPub.smembers(activeWorkflowsKey);

      if (activeWorkflowIds.length === 0) {
        console.log(`ℹ️ [MarketControl] No active streaming workflows for user ${userId}`);
        return;
      }

      console.log(`📡 [MarketControl] Updating ${activeWorkflowIds.length} active streaming workflows with new symbols:`, newSymbols);

      const subscriber = MarketDataSubscriber.getInstance();

      for (const workflowId of activeWorkflowIds) {
        try {
          // Get workflow's filter config from Redis (stored during activation)
          const filterKey = `workflow:${workflowId}:stream_filter`;
          const filterJson = await this.redisPub.get(filterKey);
          const filterConfig = filterJson ? JSON.parse(filterJson) : {};

          // Apply symbol filter if specified
          let symbolsToAdd = newSymbols;
          if (filterConfig.filter_symbols && filterConfig.filter_symbols.length > 0) {
            const allowedSymbols = filterConfig.filter_symbols.map((s: string) => s.toUpperCase());
            symbolsToAdd = newSymbols.filter(s => allowedSymbols.includes(s.toUpperCase()));

            if (symbolsToAdd.length === 0) {
              console.log(`ℹ️ [MarketControl] Workflow ${workflowId} filters exclude new symbols, skipping`);
              continue;
            }
          }

          // Add new symbols to existing subscription
          await subscriber.addSymbolsToSubscription(workflowId, symbolsToAdd);

          console.log(`✅ [MarketControl] Added ${symbolsToAdd.length} symbols to workflow ${workflowId}`);
        } catch (err) {
          console.error(`❌ [MarketControl] Failed to update workflow ${workflowId}:`, err);
        }
      }
    } catch (error) {
      console.error(`❌ [MarketControl] Failed to update active streaming workflows:`, error);
    }
  }

  /**
   * Map broker-specific stream types to normalized CorezaMarketEvent types
   * This ensures MarketDataSubscriber filters work correctly
   */
  private normalizeEventTypes(source: string, eventTypes?: string[]): string[] | undefined {
    if (!eventTypes || eventTypes.length === 0) return undefined;
    
    // Binance-specific mappings
    if (source.includes('binance')) {
      const normalized = eventTypes.map(type => {
        // All kline types normalize to 'bar'
        if (type.startsWith('kline')) return 'bar';
        // bookTicker normalizes to 'quote'
        if (type === 'bookTicker') return 'quote';
        // ticker (24h) stays as 'ticker'
        if (type === 'ticker') return 'ticker';
        // trade stays as 'trade'
        return type;
      });
      // Remove duplicates
      return [...new Set(normalized)];
    }
    
    // Alpaca-specific mappings (plural → singular)
    if (source.includes('alpaca')) {
      const normalized = eventTypes.map(type => {
        if (type === 'trades') return 'trade';
        if (type === 'quotes') return 'quote';
        if (type === 'bars') return 'bar';
        if (type === 'dailyBars') return 'daily_bar';
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
   * 
   * Uses per-workflow symbol tracking: symbols are only unsubscribed from gateway when no workflows need them.
   */
  private async handleSubscribe(msg: ControlMessage): Promise<void> {
    const { source, userId, workflowId, symbols, eventTypes, feed, environment, assetType } = msg;

    try {
      // Acquire mutex to prevent concurrent gateway connections
      await this.gatewayMutex.runExclusive(async () => {
        let state = this.sourceStates.get(source);

        // Connect gateway if needed
        if (!state || !state.gateway.getStats().connected) {
          console.log(`🔌 [MarketControl] Connecting to ${source} gateway...`);
          await this.connectGateway(source, userId, msg.credentialId, feed, environment, assetType);
          state = this.sourceStates.get(source)!;
          console.log(`✅ [MarketControl] Connected to ${source} gateway`);
        }

        // Track which workflow owns these symbols
        if (workflowId) {
          const workflowSyms = state.workflowSymbols.get(workflowId) || new Set();
          symbols.forEach(s => workflowSyms.add(s.toUpperCase()));
          state.workflowSymbols.set(workflowId, workflowSyms);
          console.log(`📝 [MarketControl] Workflow ${workflowId} owns symbols: [${[...workflowSyms].join(', ')}]`);
        }

        // Check if any symbols need new event types subscribed
        const subscriptionNeeded: string[] = [];
        const requestedTypes = eventTypes || ['trades'];
        
        for (const symbol of symbols) {
          const upperSymbol = symbol.toUpperCase();
          const existingTypes = state.symbolTypes.get(upperSymbol) || new Set();
          
          // Check if any requested type is new for this symbol
          const hasNewTypes = requestedTypes.some(t => !existingTypes.has(t));
          
          if (!state.symbols.has(upperSymbol) || hasNewTypes) {
            subscriptionNeeded.push(upperSymbol);
            // Add all requested types to tracking
            requestedTypes.forEach(t => existingTypes.add(t));
            state.symbolTypes.set(upperSymbol, existingTypes);
            state.symbols.add(upperSymbol);
          }
        }

        if (subscriptionNeeded.length > 0) {
          console.log(`➕ [MarketControl] Subscribing to symbols with new types on ${source}:`, subscriptionNeeded, `(types: ${requestedTypes.join(', ')})`);
          state.gateway.subscribeSymbols(subscriptionNeeded, eventTypes);

          // Persist to Redis
          await this.persistState(source);
          console.log(`✅ [MarketControl] Subscribed to ${subscriptionNeeded.length} symbol(s) on ${source}`);

          // Notify all active streaming workflows about new symbols
          await this.updateActiveStreamingWorkflows(userId, subscriptionNeeded);
        } else {
          console.log(`ℹ️ [MarketControl] All symbols with requested types already subscribed on ${source}`);
          // Still persist updated workflow ownership
          await this.persistState(source);
        }
      });
    } catch (error) {
      console.error(`❌ [MarketControl] Failed to handle subscribe for ${source}:`, error);
      throw error;
    }
  }

  /**
   * Check if a symbol is still needed by any workflow
   */
  private isSymbolNeededByAnyWorkflow(state: SourceState, symbol: string): boolean {
    for (const [_, workflowSyms] of state.workflowSymbols) {
      if (workflowSyms.has(symbol)) return true;
    }
    return false;
  }

  /**
   * Handle unsubscribe control message
   * 
   * Uses per-workflow symbol tracking: symbols are only unsubscribed from gateway when no workflows need them.
   * Special handling for 'streaming_workflow' source which only unregisters from MarketDataSubscriber.
   */
  private async handleUnsubscribe(msg: ControlMessage): Promise<void> {
    const { source, workflowId, symbols } = msg;

    try {
      // Special handling for streaming workflow deactivation
      // This only unregisters from MarketDataSubscriber, does NOT affect gateway subscriptions
      if (source === 'streaming_workflow' && workflowId) {
        const subscriber = MarketDataSubscriber.getInstance();
        await subscriber.unsubscribe(workflowId);
        console.log(`✅ [MarketControl] Unregistered streaming workflow ${workflowId} from MarketDataSubscriber`);
        return; // No gateway unsubscription needed
      }

      const state = this.sourceStates.get(source);
      if (!state) {
        console.log(`⚠️ [MarketControl] No gateway state found for ${source}`);
        return;
      }

      // Get symbols owned by this workflow before removing
      const workflowOwnedSymbols = workflowId 
        ? state.workflowSymbols.get(workflowId) || new Set<string>()
        : new Set(symbols.map(s => s.toUpperCase()));

      // Remove this workflow's ownership
      if (workflowId) {
        state.workflowSymbols.delete(workflowId);
        console.log(`🗑️ [MarketControl] Removed workflow ${workflowId} symbol ownership`);
      }

      // Check which symbols are no longer needed by ANY workflow
      const toRemove: string[] = [];
      
      for (const symbol of workflowOwnedSymbols) {
        const upperSymbol = symbol.toUpperCase();
        const stillNeeded = this.isSymbolNeededByAnyWorkflow(state, upperSymbol);
        
        if (!stillNeeded) {
          state.symbols.delete(upperSymbol);
          state.symbolTypes.delete(upperSymbol);
          toRemove.push(upperSymbol);
          console.log(`📊 [MarketControl] Symbol ${upperSymbol} no longer needed by any workflow (removing)`);
        } else {
          console.log(`📊 [MarketControl] Symbol ${upperSymbol} still needed by other workflow(s)`);
        }
      }

      if (toRemove.length > 0) {
        console.log(`➖ [MarketControl] Unsubscribing from symbols on ${source}:`, toRemove);
        state.gateway.unsubscribeSymbols(toRemove);
        await this.persistState(source);
        console.log(`✅ [MarketControl] Unsubscribed from ${toRemove.length} symbols on ${source}`);
      } else {
        console.log(`ℹ️ [MarketControl] Symbols still needed by other workflows, not unsubscribing from gateway`);
        await this.persistState(source); // Still persist updated workflow ownership
      }

      // Disconnect if no more workflows have symbols
      if (state.workflowSymbols.size === 0) {
        console.log(`🔌 [MarketControl] No workflows with symbols, disconnecting ${source} gateway`);
        state.gateway.disconnect();
        this.sourceStates.delete(source);
        await this.redisPub.del(REDIS_CHANNELS.gatewayState(source));
        console.log(`✅ [MarketControl] Disconnected ${source} gateway`);
      }
    } catch (error) {
      console.error(`❌ [MarketControl] Failed to handle unsubscribe for ${source}:`, error);
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
      const wsConfig = getWebSocketConfig(source);
      const serviceType = wsConfig?.credentialServiceType || source;
      const gatewaySource = (wsConfig?.gatewaySource || source) as MarketSource;

      let creds: any;

      // Use getCredentials (like brokers) when credentialId is provided
      if (credentialId) {
        const { credentials } = await CredentialManager.getCredentials(
          userId,
          serviceType,
          credentialId
        );

        if (!credentials?.client_json) {
          throw new Error(`No credentials found for ${serviceType}/${credentialId}`);
        }

        console.log(`🔑 [MarketControl] Retrieved credentials for ${serviceType}/${credentialId}`);
        creds = credentials.client_json;
      } else {
        // Fallback: get most recent credential (backward compatibility)
        const { credentials, error } = await CredentialManager.getDecryptedCredentials(
          userId,
          serviceType
        );

        if (error || !credentials) {
          throw new Error(`No credentials found for ${serviceType}: ${error}`);
        }

        console.log(`🔑 [MarketControl] Retrieved credentials for ${serviceType} (fallback)`);
        creds = credentials;
      }

      // Add feed parameter to credentials if provided (for Alpaca)
      if (feed) {
        creds = { ...creds, feed };
        console.log(`📡 [MarketControl] Using ${feed.toUpperCase()} feed for ${source}`);
      }

      // Add environment and asset type for Binance
      if (environment) {
        creds = { ...creds, environment };
        console.log(`🌐 [MarketControl] Using ${environment} environment for ${source}`);
      }
      if (assetType) {
        creds = { ...creds, assetType };
        console.log(`📊 [MarketControl] Using ${assetType} asset type for ${source}`);
      }

      // Get or create gateway instance using mapped gateway source
      const gateway = MarketDataGateway.getInstance(gatewaySource);

      // Connect gateway with credentials
      await gateway.connect(creds);

      // Track state
      this.sourceStates.set(source, {
        gateway,
        connectedUserId: userId,
        credentialId: credentialId || 'default',
        symbols: new Set(),
        symbolTypes: new Map(),
        workflowSymbols: new Map(),
      });

      console.log(`✅ [MarketControl] Gateway ${source} connected for user ${userId}`);
    } catch (error) {
      console.error(`❌ [MarketControl] Failed to connect gateway ${source}:`, error);
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
      symbolTypes: Array.from(state.symbolTypes.entries()).map(([symbol, types]) => ({
        symbol,
        types: Array.from(types),
      })),
      workflowSymbols: Array.from(state.workflowSymbols.entries()).map(([workflowId, syms]) => ({
        workflowId,
        symbols: Array.from(syms),
      })),
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
      console.warn(`⚠️ [MarketControl] Failed to persist state for ${source}, continuing with in-memory state`);
      // Continue operation - state is still in memory
    }
  }

  /**
   * Restore active subscriptions from Redis on startup
   */
  private async restoreFromRedis(): Promise<void> {
    try {
      console.log('🔄 [MarketControl] Restoring gateway states from Redis...');
      
      const sources: MarketSource[] = ['alpaca', 'alpaca_news', 'binance', 'dhan', 'schwab'];
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
            await this.connectGateway(source, stateData.userId, stateData.credentialId);
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
                const types = entry.types && Array.isArray(entry.types) ? entry.types : ['trades'];
                const typeKey = types.sort().join(',');
                if (!typeGroups.has(typeKey)) typeGroups.set(typeKey, []);
                typeGroups.get(typeKey)!.push(entry.symbol.toUpperCase());
              });
              
              // Subscribe each group with proper types
              for (const [typeKey, symbols] of typeGroups) {
                const types = typeKey.split(',');
                state.gateway.subscribeSymbols(symbols, types);
                console.log(`🔄 [MarketControl] Restored ${symbols.length} symbols on ${source} (types: ${types.join(', ')})`);
              }
            }

            // Also restore symbols set (for backwards compatibility)
            if (stateData.symbols && Array.isArray(stateData.symbols)) {
              stateData.symbols.forEach((s: string) => state.symbols.add(s.toUpperCase()));
            }

            // Restore workflow symbol ownership
            if (stateData.workflowSymbols && Array.isArray(stateData.workflowSymbols)) {
              stateData.workflowSymbols.forEach((entry: any) => {
                const syms = new Set<string>(
                  (entry.symbols || []).map((s: string) => s.toUpperCase())
                );
                state.workflowSymbols.set(entry.workflowId, syms);
              });
            }

            restoredCount++;
            console.log(`✅ [MarketControl] Restored ${source} gateway with ${state.symbols.size} symbols and ${state.workflowSymbols.size} workflows`);
          } catch (error) {
            console.error(`❌ [MarketControl] Failed to restore ${source}:`, error);
          }
        }
      }

      console.log(`✅ [MarketControl] Restored ${restoredCount} gateway(s) from Redis`);
    } catch (error) {
      console.error('❌ [MarketControl] Failed to restore from Redis:', error);
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
        workflowSymbols: Object.fromEntries(
          Array.from(state.workflowSymbols.entries()).map(([wfId, syms]) => [wfId, Array.from(syms)])
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
    console.log('🧹 [MarketControl] Cleaning up...');
    
    for (const [source, state] of this.sourceStates.entries()) {
      try {
        state.gateway.disconnect();
        console.log(`✅ [MarketControl] Disconnected ${source} gateway`);
      } catch (error) {
        console.error(`❌ [MarketControl] Error disconnecting ${source}:`, error);
      }
    }

    this.sourceStates.clear();

    await this.redisSub.quit();
    await this.redisPub.quit();
    console.log('✅ [MarketControl] Cleanup complete');
  }
}
