/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import Redis from 'ioredis';
import { getRedisCache } from '../config/redis';
import { REDIS_CHANNELS } from '../config/redisChannels';

export class SubscriptionManager {
  private static instance: SubscriptionManager;
  
  // clientId (sessionId) -> Set<symbols>
  private clientSubscriptions = new Map<string, Set<string>>();
  // symbol -> Set<clientIds>
  private symbolClients = new Map<string, Set<string>>();
  
  private redisSub: Redis;
  private redisPub: Redis;
  
  private constructor() {
    this.redisSub = getRedisCache().duplicate();
    this.redisPub = getRedisCache();
    console.log('✅ SubscriptionManager initialized');
  }
  
  static getInstance(): SubscriptionManager {
    if (!this.instance) {
      this.instance = new SubscriptionManager();
    }
    return this.instance;
  }
  
  async subscribeClient(clientId: string, symbols: string[]): Promise<void> {
    if (!this.clientSubscriptions.has(clientId)) {
      this.clientSubscriptions.set(clientId, new Set());
    }
    
    const clientSymbols = this.clientSubscriptions.get(clientId)!;
    
    for (const symbol of symbols) {
      const normalized = symbol === '*' ? '*' : symbol.toUpperCase();
      clientSymbols.add(normalized);
      
      if (!this.symbolClients.has(normalized)) {
        this.symbolClients.set(normalized, new Set());
        // First subscriber for this symbol - subscribe to Redis channel
        await this.redisSub.subscribe(REDIS_CHANNELS.marketData(normalized));
        console.log(`[SubscriptionManager] Subscribed to Redis channel: ${REDIS_CHANNELS.marketData(normalized)}`);
        
        // Notify gateway to subscribe to exchange (format expected by MarketControlHandler)
        await this.redisPub.publish(
          REDIS_CHANNELS.controlSubscribe,
          JSON.stringify({ 
            action: 'subscribe',
            userId: clientId,
            symbols: [normalized],
            source: 'alpaca' // Default to alpaca, can be made dynamic later
          })
        );
        console.log(`[SubscriptionManager] Published control message to subscribe: ${normalized}`);
      }
      this.symbolClients.get(normalized)!.add(clientId);
    }
    
    console.log(`[SubscriptionManager] Client ${clientId} subscribed to: ${symbols.join(', ')}`);
    console.log(`[SubscriptionManager] Total symbols tracked: ${this.symbolClients.size}`);
  }
  
  async unsubscribeClient(clientId: string, symbols: string[]): Promise<void> {
    const clientSymbols = this.clientSubscriptions.get(clientId);
    if (!clientSymbols) return;
    
    for (const symbol of symbols) {
      const normalized = symbol === '*' ? '*' : symbol.toUpperCase();
      clientSymbols.delete(normalized);
      
      const clients = this.symbolClients.get(normalized);
      if (clients) {
        clients.delete(clientId);
        if (clients.size === 0) {
          // No more subscribers - unsubscribe from Redis
          this.symbolClients.delete(normalized);
          await this.redisSub.unsubscribe(REDIS_CHANNELS.marketData(normalized));
          console.log(`[SubscriptionManager] Unsubscribed from Redis channel: ${REDIS_CHANNELS.marketData(normalized)}`);
          
          await this.redisPub.publish(
            REDIS_CHANNELS.controlUnsubscribe,
            JSON.stringify({ 
              action: 'unsubscribe',
              userId: clientId,
              symbols: [normalized],
              source: 'alpaca' // Default to alpaca, can be made dynamic later
            })
          );
          console.log(`[SubscriptionManager] Published control message to unsubscribe: ${normalized}`);
        }
      }
    }
    
    if (clientSymbols.size === 0) {
      this.clientSubscriptions.delete(clientId);
    }
    
    console.log(`[SubscriptionManager] Client ${clientId} unsubscribed from: ${symbols.join(', ')}`);
  }
  
  async removeClient(clientId: string): Promise<void> {
    const symbols = this.clientSubscriptions.get(clientId);
    if (symbols) {
      await this.unsubscribeClient(clientId, Array.from(symbols));
    }
  }
  
  getClientsForSymbol(symbol: string): Set<string> {
    return this.symbolClients.get(symbol.toUpperCase()) || new Set();
  }
  
  onMessage(handler: (symbol: string, data: string) => void): void {
    this.redisSub.on('message', (channel, message) => {
      if (channel.startsWith('md:symbol:')) {
        const symbol = channel.split(':')[2];
        handler(symbol, message);
      }
    });
  }
  
  getStats() {
    return {
      totalClients: this.clientSubscriptions.size,
      totalSymbols: this.symbolClients.size,
      clients: Array.from(this.clientSubscriptions.entries()).map(([clientId, symbols]) => ({
        clientId,
        symbols: Array.from(symbols),
      })),
      symbols: Array.from(this.symbolClients.entries()).map(([symbol, clients]) => ({
        symbol,
        clientCount: clients.size,
      })),
    };
  }
}
