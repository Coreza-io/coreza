import WebSocket from 'ws';
import { getRedis } from '../config/redis';
import { REDIS_CHANNELS } from '../config/redisChannels';
import { GatewayConfig, GATEWAY_CONFIGS } from '../config/marketGateways';
import { CorezaMarketEvent, MarketSource } from '../types/marketEvent';
import { redisPublishBreaker } from '../utils/redisCircuitBreaker';
import { RedisBuffer } from './RedisBuffer';
import { createLogger } from '../utils/logger';
import { marketMessagesCounter, marketMessageLatencyHistogram, activeGatewayConnectionsGauge } from '../utils/metrics';
import { alertGatewayDisconnected, alertMaxReconnectAttempts } from '../utils/alerting';

export class MarketDataGateway {
  private static instances = new Map<MarketSource, MarketDataGateway>();
  
  private ws: WebSocket | null = null;
  private config: GatewayConfig;
  private credentials: any = null;
  private subscribedSymbols = new Set<string>();
  private subscribedTypes: string[] = []; // Track subscribed event types for reconnection
  private isAuthenticated = false;
  private reconnectAttempts = 0;
  private redis = getRedis();
  private logger = createLogger('MarketDataGateway');
  
  private constructor(config: GatewayConfig) {
    this.config = config;
  }
  
  static getInstance(source: MarketSource): MarketDataGateway {
    if (!this.instances.has(source)) {
      const config = GATEWAY_CONFIGS[source];
      if (!config) throw new Error(`Unknown market source: ${source}`);
      this.instances.set(source, new MarketDataGateway(config));
    }
    return this.instances.get(source)!;
  }
  
  async connect(credentials: any): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    
    this.credentials = credentials;
    
    // Run pre-connect setup if required (e.g., Schwab OAuth streaming URL fetch)
    if (this.config.requiresPreConnect && this.config.preConnect) {
      this.logger.info({ source: this.config.id }, 'Running pre-connect setup');
      this.credentials = await this.config.preConnect(credentials);
    }
    
    const url = typeof this.config.wsUrl === 'function' 
      ? this.config.wsUrl(this.credentials) 
      : this.config.wsUrl;
    
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: this.config.makeAuthHeaders?.(credentials),
      });
      
      this.ws.on('open', () => {
        this.logger.info({ source: this.config.id }, 'Gateway connected');
        activeGatewayConnectionsGauge.set({ source: this.config.id }, 1);
        const authMsg = this.config.makeAuthMessage?.(this.credentials);
        if (authMsg) {
          const payload = this.config.isBinary 
            ? this.encodeMessage(authMsg)
            : JSON.stringify(authMsg);
          this.ws!.send(payload);
        } else {
          this.isAuthenticated = true;
          this.resubscribeAll();
          resolve();
        }
      });
      
      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);
        if (!this.isAuthenticated) {
          this.isAuthenticated = true;
          this.resubscribeAll();
          resolve();
        }
      });
      
      this.ws.on('close', () => {
        this.logger.warn({ source: this.config.id }, 'Gateway disconnected');
        activeGatewayConnectionsGauge.set({ source: this.config.id }, 0);
        alertGatewayDisconnected(this.config.id, 'Connection closed');
        this.handleReconnect();
      });
      
      this.ws.on('error', (err) => {
        this.logger.error({ source: this.config.id, error: err }, 'Gateway error');
        reject(err);
      });
    });
  }
  
  private async handleMessage(buffer: Buffer): Promise<void> {
    try {
      const startTime = Date.now();
      const messages = this.config.parseMessage(buffer);
      for (const msg of messages) {
        if (!this.config.shouldPublish(msg)) continue;
        
        const event = this.config.normalize(msg);
        if (!event || !event.symbol) continue;
        
        // Publish to Redis symbol channel with circuit breaker
        const channel = REDIS_CHANNELS.marketData(event.symbol);
        await this.publishToRedis(channel, JSON.stringify(event));
        
        // Metrics
        marketMessagesCounter.inc({ source: this.config.id, symbol: event.symbol, type: event.type });
        const latency = (Date.now() - startTime) / 1000;
        marketMessageLatencyHistogram.observe({ source: this.config.id }, latency);
        
        this.logger.debug({ source: this.config.id, symbol: event.symbol, type: event.type, price: event.lastPrice || event.c }, 'Market event published');
      }
    } catch (error) {
      this.logger.error({ source: this.config.id, error }, 'Message parse error');
    }
  }

  /**
   * Publish to Redis with circuit breaker and fallback buffering
   */
  private async publishToRedis(channel: string, message: string): Promise<void> {
    try {
      await redisPublishBreaker.fire(channel, message);
    } catch (error) {
      this.logger.warn({ source: this.config.id, channel }, 'Redis unavailable, buffering message');
      RedisBuffer.getInstance().bufferMessage(channel, message);
    }
  }
  
  subscribeSymbols(symbols: string[], types?: string[]): void {
    const newSymbols = symbols.filter(s => !this.subscribedSymbols.has(s.toUpperCase()));
    if (newSymbols.length === 0) return;
    
    // Store types for reconnection
    if (types && types.length > 0) {
      this.subscribedTypes = types;
    }
    
    newSymbols.forEach(s => this.subscribedSymbols.add(s.toUpperCase()));
    
    if (this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated) {
      const msg = this.config.makeSubscribeMessage(newSymbols, types);
      const payload = this.encodeMessage(msg);
      this.ws.send(payload);
      console.log(`[${this.config.id}] Subscribed to: ${newSymbols.join(', ')} (types: ${types?.join(', ') || 'default'})`);
    }
  }
  
  unsubscribeSymbols(symbols: string[]): void {
    const toRemove = symbols.filter(s => this.subscribedSymbols.has(s.toUpperCase()));
    if (toRemove.length === 0) return;
    
    toRemove.forEach(s => this.subscribedSymbols.delete(s.toUpperCase()));
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      const msg = this.config.makeUnsubscribeMessage(toRemove);
      const payload = this.encodeMessage(msg);
      this.ws.send(payload);
      console.log(`[${this.config.id}] Unsubscribed from: ${toRemove.join(', ')}`);
    }
  }
  
  private resubscribeAll(): void {
    if (this.subscribedSymbols.size > 0) {
      const msg = this.config.makeSubscribeMessage(
        Array.from(this.subscribedSymbols),
        this.subscribedTypes.length > 0 ? this.subscribedTypes : undefined
      );
      const payload = this.encodeMessage(msg);
      this.ws?.send(payload);
      const typesInfo = this.subscribedTypes.length > 0 ? ` (types: ${this.subscribedTypes.join(', ')})` : '';
      console.log(`[${this.config.id}] Resubscribed to ${this.subscribedSymbols.size} symbols${typesInfo}`);
    }
  }
  
  private encodeMessage(msg: any): Buffer | string {
    // Binary protocol (Dhan)
    if (this.config.isBinary) {
      const { encodeDhanSubscribeMessage, encodeDhanUnsubscribeMessage } = require('../utils/dhanBinaryParser');
      if (msg.RequestCode === 15) {
        return encodeDhanSubscribeMessage(
          msg.InstrumentList.map((i: any) => i.SecurityId),
          msg.InstrumentList[0]?.ExchangeSegment || 'NSE_EQ'
        );
      } else if (msg.RequestCode === 16) {
        return encodeDhanUnsubscribeMessage(
          msg.InstrumentList.map((i: any) => i.SecurityId),
          msg.InstrumentList[0]?.ExchangeSegment || 'NSE_EQ'
        );
      }
      return Buffer.from(JSON.stringify(msg));
    }
    
    // JSON protocol (default)
    return JSON.stringify(msg);
  }
  
  private handleReconnect(): void {
    const maxAttempts = this.config.maxReconnectAttempts ?? 5;
    if (this.reconnectAttempts >= maxAttempts) {
      console.error(`[${this.config.id}] Max reconnection attempts reached`);
      return;
    }
    
    const delay = (this.config.reconnectDelay ?? 1000) * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    
    console.log(`[${this.config.id}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${maxAttempts})`);
    
    setTimeout(() => {
      if (this.credentials) this.connect(this.credentials);
    }, delay);
  }
  
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isAuthenticated = false;
    this.reconnectAttempts = 0;
  }
  
  getStats() {
    return {
      source: this.config.id,
      connected: this.ws?.readyState === WebSocket.OPEN,
      authenticated: this.isAuthenticated,
      subscribedSymbols: Array.from(this.subscribedSymbols),
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}
