import { CorezaMarketEvent, MarketSource } from '../types/marketEvent';

export interface GatewayConfig {
  id: MarketSource;
  wsUrl: string | ((creds: any) => string);
  
  // Authentication
  makeAuthMessage?: (creds: any) => any;
  makeAuthHeaders?: (creds: any) => Record<string, string>;
  
  // Subscription management
  makeSubscribeMessage: (symbols: string[], types?: string[]) => any;
  makeUnsubscribeMessage: (symbols: string[], types?: string[]) => any;
  
  // Message processing
  parseMessage: (buffer: Buffer) => any[];
  identifyMessageType: (msg: any) => string;
  shouldPublish: (msg: any) => boolean;
  
  // CRITICAL: Normalizer to CorezaMarketEvent
  normalize: (msg: any) => CorezaMarketEvent | null;
  
  // Connection settings
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

export const GATEWAY_CONFIGS: Record<MarketSource, GatewayConfig> = {
  alpaca: {
    id: 'alpaca',
    wsUrl: 'wss://stream.data.alpaca.markets/v2/iex',
    makeAuthMessage: (creds) => ({
      action: 'auth',
      key: creds.api_key,
      secret: creds.secret_key,
    }),
    makeSubscribeMessage: (symbols, types = ['trades']) => {
      const msg: any = { action: 'subscribe' };
      types.forEach(t => { msg[t] = symbols; });
      return msg;
    },
    makeUnsubscribeMessage: (symbols, types = ['trades']) => {
      const msg: any = { action: 'unsubscribe' };
      types.forEach(t => { msg[t] = symbols; });
      return msg;
    },
    parseMessage: (buffer) => JSON.parse(buffer.toString()),
    identifyMessageType: (msg) => msg.T,
    shouldPublish: (msg) => ['t', 'q', 'b', 'd'].includes(msg.T),
    normalize: (msg) => {
      const base = {
        source: 'alpaca' as const,
        symbol: msg.S?.toUpperCase(),
        ts: msg.t ? new Date(msg.t).toISOString() : new Date().toISOString(),
        raw: msg,
      };
      
      switch (msg.T) {
        case 't': return { ...base, type: 'trade' as const, lastPrice: msg.p, size: msg.s, exchange: msg.x };
        case 'q': return { ...base, type: 'quote' as const, bid: msg.bp, bidSize: msg.bs, ask: msg.ap, askSize: msg.as };
        case 'b': return { ...base, type: 'bar' as const, o: msg.o, h: msg.h, l: msg.l, c: msg.c, v: msg.v, vwap: msg.vw, timeframe: '1m' as const };
        case 'd': return { ...base, type: 'daily_bar' as const, o: msg.o, h: msg.h, l: msg.l, c: msg.c, v: msg.v, timeframe: '1d' as const };
        default: return null;
      }
    },
    reconnectDelay: 1000,
    maxReconnectAttempts: 5,
  },
  
  binance: {
    id: 'binance',
    wsUrl: 'wss://stream.binance.com:9443/ws',
    makeSubscribeMessage: (symbols) => ({
      method: 'SUBSCRIBE',
      params: symbols.map(s => `${s.toLowerCase()}@trade`),
      id: Date.now(),
    }),
    makeUnsubscribeMessage: (symbols) => ({
      method: 'UNSUBSCRIBE',
      params: symbols.map(s => `${s.toLowerCase()}@trade`),
      id: Date.now(),
    }),
    parseMessage: (buffer) => [JSON.parse(buffer.toString())],
    identifyMessageType: (msg) => msg.e || 'unknown',
    shouldPublish: (msg) => msg.e === 'trade',
    normalize: (msg) => {
      if (msg.e !== 'trade') return null;
      return {
        source: 'binance' as const,
        symbol: msg.s?.toUpperCase(),
        type: 'trade' as const,
        ts: new Date(msg.T).toISOString(),
        lastPrice: parseFloat(msg.p),
        size: parseFloat(msg.q),
        raw: msg,
      };
    },
    reconnectDelay: 1000,
    maxReconnectAttempts: 5,
  },
  
  // TODO: Implement Dhan gateway configuration
  dhan: {
    id: 'dhan',
    wsUrl: '',
    makeSubscribeMessage: () => ({}),
    makeUnsubscribeMessage: () => ({}),
    parseMessage: () => [],
    identifyMessageType: () => 'unknown',
    shouldPublish: () => false,
    normalize: () => null,
  },
  
  // TODO: Implement Schwab gateway configuration
  schwab: {
    id: 'schwab',
    wsUrl: '',
    makeSubscribeMessage: () => ({}),
    makeUnsubscribeMessage: () => ({}),
    parseMessage: () => [],
    identifyMessageType: () => 'unknown',
    shouldPublish: () => false,
    normalize: () => null,
  },
};
