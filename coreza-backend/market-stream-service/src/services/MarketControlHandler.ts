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

      // Subscribe to control channels
      await this.redisSub.subscribe(
        REDIS_CHANNELS.controlSubscribe,
        REDIS_CHANNELS.controlUnsubscribe
      );
      console.log('✅ [MarketControl] Subscribed to control channels');

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
        const msg: ControlMessage = JSON.parse(message);
        console.log(`📨 [MarketControl] Received ${msg.action} on ${channel}:`, {
          source: msg.source,
          symbols: msg.symbols,
          workflowId: msg.workflowId,
          nodeId: msg.nodeId,
          userId: msg.userId,
          credentialId: msg.credentialId
        });

        if (channel === REDIS_CHANNELS.controlSubscribe) {
          await this.handleSubscribe(msg);
        } else if (channel === REDIS_CHANNELS.controlUnsubscribe) {
          await this.handleUnsubscribe(msg);
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
   * Handle subscribe control message (with mutex protection)
   */
  private async handleSubscribe(msg: ControlMessage): Promise<void> {
    const { source, userId, workflowId, nodeId, symbols, eventTypes, feed } = msg;

    try {
      // Acquire mutex to prevent concurrent gateway connections
      await this.gatewayMutex.runExclusive(async () => {
        let state = this.sourceStates.get(source);

        // Connect gateway if needed
        if (!state || !state.gateway.getStats().connected) {
          console.log(`🔌 [MarketControl] Connecting to ${source} gateway...`);
          await this.connectGateway(source, userId, msg.credentialId, feed);
          state = this.sourceStates.get(source)!;
          console.log(`✅ [MarketControl] Connected to ${source} gateway`);
        }

        // Track workflow symbols
        if (workflowId) {
          const currentSymbols = state.workflowSymbols.get(workflowId) || new Set();
          symbols.forEach(s => currentSymbols.add(s.toUpperCase()));
          state.workflowSymbols.set(workflowId, currentSymbols);
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
        } else {
          console.log(`ℹ️ [MarketControl] All symbols with requested types already subscribed on ${source}`);
        }

        // Register workflow with MarketDataSubscriber for workflow triggering
        if (workflowId && nodeId) {
          const subscriber = MarketDataSubscriber.getInstance();
          await subscriber.subscribe(
            workflowId,
            nodeId,
            userId,
            symbols,
            {
              source,
              eventTypes: eventTypes as any,
            }
          );
          console.log(`✅ [MarketControl] Registered workflow ${workflowId} with MarketDataSubscriber`);
        }
      });
    } catch (error) {
      console.error(`❌ [MarketControl] Failed to handle subscribe for ${source}:`, error);
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
        console.log(`✅ [MarketControl] Unregistered workflow ${workflowId} from MarketDataSubscriber`);
      }

      // Remove workflow tracking
      if (workflowId) {
        state.workflowSymbols.delete(workflowId);
        console.log(`🗑️ [MarketControl] Removed workflow ${workflowId} from ${source}`);
      }

      // Recalculate needed symbols from all remaining workflows
      const neededSymbols = new Set<string>();
      for (const wfSymbols of state.workflowSymbols.values()) {
        wfSymbols.forEach(s => neededSymbols.add(s.toUpperCase()));
      }

      // Find symbols to unsubscribe
      const toRemove = symbols
        .filter(s => !neededSymbols.has(s.toUpperCase()) && state.symbols.has(s.toUpperCase()));

      if (toRemove.length > 0) {
        console.log(`➖ [MarketControl] Unsubscribing from symbols on ${source}:`, toRemove);
        toRemove.forEach(s => state.symbols.delete(s.toUpperCase()));
        state.gateway.unsubscribeSymbols(toRemove);
        await this.persistState(source);
        console.log(`✅ [MarketControl] Unsubscribed from ${toRemove.length} symbols on ${source}`);
      }

      // Disconnect if no more symbols
      if (state.symbols.size === 0) {
        console.log(`🔌 [MarketControl] No symbols left, disconnecting ${source} gateway`);
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
    feed?: string
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

      // Add feed parameter to credentials if provided
      if (feed) {
        creds = { ...creds, feed };
        console.log(`📡 [MarketControl] Using ${feed.toUpperCase()} feed for ${source}`);
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
      workflowSymbols: Array.from(state.workflowSymbols.entries()).map(([wfId, symbols]) => ({
        workflowId: wfId,
        symbols: Array.from(symbols),
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
      
      const sources: MarketSource[] = ['alpaca', 'binance', 'dhan', 'schwab'];
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

            // Restore workflow mappings
            if (stateData.workflowSymbols && Array.isArray(stateData.workflowSymbols)) {
              stateData.workflowSymbols.forEach((wf: any) => {
                const symbols = new Set<string>();
                if (wf.symbols && Array.isArray(wf.symbols)) {
                  wf.symbols.forEach((s: string) => symbols.add(s.toUpperCase()));
                }
                state.workflowSymbols.set(wf.workflowId, symbols);
              });
            }

            restoredCount++;
            console.log(`✅ [MarketControl] Restored ${source} gateway with ${state.symbols.size} symbols`);
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
        workflows: Array.from(state.workflowSymbols.entries()).map(([wfId, symbols]) => ({
          workflowId: wfId,
          symbolCount: symbols.size,
        })),
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
