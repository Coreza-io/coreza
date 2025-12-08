import { CorezaMarketEvent, MarketSource } from '../types/marketEvent';

// Map singular event types to Alpaca's plural API keys
const ALPACA_TYPE_TO_KEY: Record<string, string> = {
  'trade': 'trades',
  'quote': 'quotes', 
  'bar': 'bars',
  'daily_bar': 'dailyBars',
  // Fallback: if already plural, keep as-is
  'trades': 'trades',
  'quotes': 'quotes',
  'bars': 'bars',
  'dailyBars': 'dailyBars',
};

export interface GatewayConfig {
  id: MarketSource;
  wsUrl: string | ((creds: any) => string);
  
  // Authentication
  makeAuthMessage?: (creds: any) => any;
  makeAuthHeaders?: (creds: any) => Record<string, string>;
  isAuthSuccess?: (msg: any) => boolean;  // Check if auth succeeded
  isAuthError?: (msg: any) => boolean;    // Check if auth failed
  
  // Subscription management
  makeSubscribeMessage: (symbols: string[], types?: string[]) => any;
  makeUnsubscribeMessage: (symbols: string[], types?: string[]) => any;
  
  // Message processing
  parseMessage: (buffer: Buffer) => any[];
  identifyMessageType: (msg: any) => string;
  shouldPublish: (msg: any) => boolean;
  handleControlMessage?: (msg: any, logger: any) => void;  // Handle control messages
  
  // CRITICAL: Normalizer to CorezaMarketEvent
  normalize: (msg: any) => CorezaMarketEvent | null;
  
  // Connection settings
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  
  // Protocol flags
  isBinary?: boolean;                    // Uses binary WebSocket protocol (Dhan)
  requiresPreConnect?: boolean;          // Needs setup before connect (Schwab OAuth)
  preConnect?: (creds: any) => Promise<any>;  // Pre-connection setup hook
}

export const GATEWAY_CONFIGS: Record<MarketSource, GatewayConfig> = {
  alpaca: {
    id: 'alpaca',
    wsUrl: (creds) => {
      const feed = creds.feed || 'iex';
      return `wss://stream.data.alpaca.markets/v2/${feed}`;
    },
    makeAuthMessage: (creds) => ({
      action: 'auth',
      key: creds.api_key,
      secret: creds.secret_key,
    }),
    isAuthSuccess: (msg) => {
      return Array.isArray(msg) ? msg.some(m => m.T === 'success') : msg.T === 'success';
    },
    isAuthError: (msg) => {
      return Array.isArray(msg) ? msg.some(m => m.T === 'error') : msg.T === 'error';
    },
    handleControlMessage: (msg, logger) => {
      const messages = Array.isArray(msg) ? msg : [msg];
      for (const m of messages) {
        if (m.T === 'subscription') {
          logger.info({ source: 'alpaca', subscriptions: m }, 'Subscription confirmation received');
        } else if (m.T === 'error') {
          logger.error({ source: 'alpaca', error: m }, 'Error message received');
        } else if (m.T === 'success') {
          logger.info({ source: 'alpaca', msg: m.msg }, 'Success message received');
        }
      }
    },
    makeSubscribeMessage: (symbols, types = ['trade']) => {
      const msg: any = { action: 'subscribe' };
      types.forEach(t => {
        const key = ALPACA_TYPE_TO_KEY[t] || `${t}s`;
        msg[key] = symbols;
      });
      return msg;
    },
    makeUnsubscribeMessage: (symbols, types = ['trade']) => {
      const msg: any = { action: 'unsubscribe' };
      types.forEach(t => {
        const key = ALPACA_TYPE_TO_KEY[t] || `${t}s`;
        msg[key] = symbols;
      });
      return msg;
    },
    parseMessage: (buffer) => {
      const parsed = JSON.parse(buffer.toString());
      return Array.isArray(parsed) ? parsed : [parsed];
    },
    identifyMessageType: (msg) => msg.T,
    shouldPublish: (msg) => ['t', 'q', 'b', 'd'].includes(msg.T),
    normalize: (msg) => {
      const symbol = msg.S?.toUpperCase();
      const t = msg.t ? new Date(msg.t).getTime() : Date.now();
      
      switch (msg.T) {
        case 't': 
          return { 
            source: 'alpaca' as const, 
            symbol, 
            t, 
            type: 'trade' as const, 
            p: msg.p, 
            q: msg.s, 
            x: msg.x 
          };
        case 'q': 
          return { 
            source: 'alpaca' as const, 
            symbol, 
            t, 
            type: 'quote' as const, 
            b: msg.bp, 
            B: msg.bs, 
            a: msg.ap, 
            A: msg.as 
          };
        case 'b': 
          return { 
            source: 'alpaca' as const, 
            symbol, 
            t, 
            type: 'bar' as const, 
            o: msg.o, 
            h: msg.h, 
            l: msg.l, 
            c: msg.c, 
            v: msg.v, 
            vw: msg.vw, 
            timeframe: '1m' 
          };
        case 'd': 
          return { 
            source: 'alpaca' as const, 
            symbol, 
            t, 
            type: 'daily_bar' as const, 
            o: msg.o, 
            h: msg.h, 
            l: msg.l, 
            c: msg.c, 
            v: msg.v, 
            timeframe: '1d' 
          };
        default: return null;
      }
    },
    reconnectDelay: 1000,
    maxReconnectAttempts: 5,
  },
  
  alpaca_news: {
    id: 'alpaca_news',
    wsUrl: 'wss://stream.data.alpaca.markets/v1beta1/news',
    makeAuthMessage: (creds) => ({
      action: 'auth',
      key: creds.api_key,
      secret: creds.secret_key,
    }),
    isAuthSuccess: (msg) => {
      return Array.isArray(msg) ? msg.some(m => m.T === 'success') : msg.T === 'success';
    },
    isAuthError: (msg) => {
      return Array.isArray(msg) ? msg.some(m => m.T === 'error') : msg.T === 'error';
    },
    handleControlMessage: (msg, logger) => {
      const messages = Array.isArray(msg) ? msg : [msg];
      for (const m of messages) {
        if (m.T === 'subscription') {
          logger.info({ source: 'alpaca_news', subscriptions: m }, 'Subscription confirmation received');
        } else if (m.T === 'error') {
          logger.error({ source: 'alpaca_news', error: m }, 'Error message received');
        } else if (m.T === 'success') {
          logger.info({ source: 'alpaca_news', msg: m.msg }, 'Success message received');
        }
      }
    },
    makeSubscribeMessage: (symbols) => ({
      action: 'subscribe',
      news: symbols,
    }),
    makeUnsubscribeMessage: (symbols) => ({
      action: 'unsubscribe',
      news: symbols,
    }),
    parseMessage: (buffer) => {
      const parsed = JSON.parse(buffer.toString());
      return Array.isArray(parsed) ? parsed : [parsed];
    },
    identifyMessageType: (msg) => msg.T,
    shouldPublish: (msg) => msg.T === 'n',
    normalize: (msg) => {
      if (msg.T !== 'n') return null;
      return {
        source: 'alpaca_news' as const,
        symbol: msg.symbols?.[0]?.toUpperCase() || '*',
        type: 'news' as const,
        t: msg.created_at ? new Date(msg.created_at).getTime() : Date.now(),
        headline: msg.headline,
        summary: msg.summary,
        author: msg.author,
        url: msg.url,
        symbols: msg.symbols,
        newsSource: msg.source,
      } as any;
    },
    reconnectDelay: 1000,
    maxReconnectAttempts: 5,
  },
  
  binance: {
    id: 'binance',
    wsUrl: (creds) => {
      const isTestnet = creds.environment === 'testnet';
      const assetType = creds.asset_type || 'spot';

      if (assetType === 'futures') {
        return isTestnet
          ? 'wss://stream.testnet.binancefuture.com/ws'
          : 'wss://fstream.binance.com/ws';
      }

      return isTestnet
        ? 'wss://stream.testnet.binance.vision/ws'
        : 'wss://stream.binance.com:9443/ws';
    },

    makeSubscribeMessage: (symbols, types = ['trade']) => ({
      method: 'SUBSCRIBE',
      params: symbols.flatMap(s => types.map(t => `${s.toLowerCase()}@${t}`)),
      id: Date.now(),
    }),

    makeUnsubscribeMessage: (symbols, types = ['trade']) => ({
      method: 'UNSUBSCRIBE',
      params: symbols.flatMap(s => types.map(t => `${s.toLowerCase()}@${t}`)),
      id: Date.now(),
    }),

    parseMessage: (buffer) => [JSON.parse(buffer.toString())],
    identifyMessageType: (msg) => msg.e || (msg.result !== undefined ? 'result' : 'unknown'),
    shouldPublish: (msg) => ['trade', 'kline', 'bookTicker', '24hrTicker'].includes(msg.e),

    handleControlMessage: (msg, logger) => {
      if (msg.result !== undefined) {
        logger.info({ source: 'binance', id: msg.id }, 'Subscription confirmed');
      }
    },

    normalize: (msg) => {
      const symbol = msg.s?.toUpperCase();
      const t = msg.E || msg.T || Date.now();

      switch (msg.e) {
        case 'trade':
          return {
            symbol,
            t,
            p: parseFloat(msg.p),
            q: parseFloat(msg.q),
            type: 'trade' as const,
            source: 'binance' as const,
          };

        case 'kline': {
          const k = msg.k;
          return {
            symbol,
            t: k.t,  // kline start time
            o: parseFloat(k.o),
            h: parseFloat(k.h),
            l: parseFloat(k.l),
            c: parseFloat(k.c),
            v: parseFloat(k.v),
            timeframe: k.i,
            isClosed: k.x,
            type: 'bar' as const,
            source: 'binance' as const,
          };
        }

        case 'bookTicker':
          return {
            symbol,
            t,
            b: parseFloat(msg.b),
            B: parseFloat(msg.B),
            a: parseFloat(msg.a),
            A: parseFloat(msg.A),
            type: 'quote' as const,
            source: 'binance' as const,
          };

        case '24hrTicker':
          return {
            symbol,
            t,
            c: parseFloat(msg.c),  // current/last price as close
            pc: parseFloat(msg.p),
            pcp: parseFloat(msg.P),
            v: parseFloat(msg.v),
            type: 'ticker' as const,
            source: 'binance' as const,
          };

        default:
          return null;
      }
    },
    reconnectDelay: 1000,
    maxReconnectAttempts: 5,
  },
  
  // Dhan - Binary WebSocket protocol
  dhan: {
    id: 'dhan',
    wsUrl: (creds) => `wss://api-feed.dhan.co?version=2&token=${creds.api_key}&clientId=${creds.client_id}&authType=2`,
    
    makeAuthMessage: undefined,
    
    makeSubscribeMessage: (symbols, types = ['ticker']) => {
      return {
        RequestCode: 15,
        InstrumentCount: symbols.length,
        InstrumentList: symbols.map(s => ({
          ExchangeSegment: 'NSE_EQ',
          SecurityId: s,
        })),
      };
    },
    
    makeUnsubscribeMessage: (symbols) => ({
      RequestCode: 16,
      InstrumentCount: symbols.length,
      InstrumentList: symbols.map(s => ({
        ExchangeSegment: 'NSE_EQ',
        SecurityId: s,
      })),
    }),
    
    parseMessage: (buffer) => {
      const { parseDhanBinaryPacket } = require('../utils/dhanBinaryParser');
      return parseDhanBinaryPacket(buffer);
    },
    
    identifyMessageType: (msg) => msg.type || 'unknown',
    shouldPublish: (msg) => ['ticker', 'quote', 'full'].includes(msg.type),
    
    normalize: (msg) => {
      if (!msg.SecurityId) return null;
      return {
        source: 'dhan' as const,
        symbol: msg.TradingSymbol || msg.SecurityId,
        type: 'trade' as const,
        t: Date.now(),
        p: msg.LTP,
        b: msg.BidPrice,
        B: msg.BidQty,
        a: msg.AskPrice,
        A: msg.AskQty,
        o: msg.Open,
        h: msg.High,
        l: msg.Low,
        c: msg.Close,
        v: msg.Volume,
      };
    },
    
    reconnectDelay: 2000,
    maxReconnectAttempts: 5,
    isBinary: true,
  },
  
  // Schwab - OAuth with dynamic streaming URL
  schwab: {
    id: 'schwab',
    wsUrl: (creds) => creds.streamerSocketUrl,
    
    preConnect: async (creds) => {
      const { fetchSchwabStreamingConfig } = require('../utils/schwabStreamingSetup');
      return await fetchSchwabStreamingConfig(creds.access_token);
    },
    
    makeAuthMessage: (creds) => {
      const { buildSchwabLoginMessage } = require('../utils/schwabStreamingSetup');
      return buildSchwabLoginMessage(creds);
    },
    
    makeSubscribeMessage: (symbols, types = ['quotes']) => ({
      requests: [{
        requestid: String(Date.now()),
        service: 'LEVELONE_EQUITIES',
        command: 'SUBS',
        parameters: {
          keys: symbols.join(','),
          fields: '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,28',
        },
      }],
    }),
    
    makeUnsubscribeMessage: (symbols) => ({
      requests: [{
        requestid: String(Date.now()),
        service: 'LEVELONE_EQUITIES',
        command: 'UNSUBS',
        parameters: {
          keys: symbols.join(','),
        },
      }],
    }),
    
    parseMessage: (buffer) => {
      const parsed = JSON.parse(buffer.toString());
      const { parseSchwabStreamingMessage } = require('../utils/schwabStreamingSetup');
      return parseSchwabStreamingMessage(parsed);
    },
    
    identifyMessageType: (msg) => {
      if (msg.service === 'LEVELONE_EQUITIES') return 'quote';
      if (msg.service === 'CHART_EQUITY') return 'bar';
      return msg.service || 'unknown';
    },
    
    shouldPublish: (msg) => 
      msg.service === 'LEVELONE_EQUITIES' && msg.content?.length > 0,
    
    normalize: (msg) => {
      if (msg.service !== 'LEVELONE_EQUITIES') return null;
      
      const content = msg.content?.[0];
      if (!content) return null;
      
      return {
        source: 'schwab' as const,
        symbol: content.key?.toUpperCase() || content['0']?.toUpperCase(),
        type: 'quote' as const,
        t: Date.now(),
        p: content['3'],
        b: content['1'],
        B: content['4'],
        a: content['2'],
        A: content['5'],
        o: content['28'],
        h: content['12'],
        l: content['13'],
        c: content['15'],
        v: content['8'],
      };
    },
    
    reconnectDelay: 2000,
    maxReconnectAttempts: 5,
    requiresPreConnect: true,
  },
};

// ============================================================
// Source Mapping: Maps frontend/control message source IDs to gateway sources
// This consolidates the mapping previously in websockets.ts
// ============================================================

export interface SourceMapping {
  credentialServiceType: string;
  gatewaySource: MarketSource;
}

export const SOURCE_MAPPING: Record<string, SourceMapping> = {
  // Frontend stream node IDs → gateway sources
  'alpaca_stream': { credentialServiceType: 'alpaca', gatewaySource: 'alpaca' },
  'alpaca_news': { credentialServiceType: 'alpaca', gatewaySource: 'alpaca_news' },
  'binance_stream': { credentialServiceType: 'binance', gatewaySource: 'binance' },
  'dhan_stream': { credentialServiceType: 'dhan', gatewaySource: 'dhan' },
  'schwab_stream': { credentialServiceType: 'schwab', gatewaySource: 'schwab' },
  
  // Direct gateway names (already normalized)
  'alpaca': { credentialServiceType: 'alpaca', gatewaySource: 'alpaca' },
  'binance': { credentialServiceType: 'binance', gatewaySource: 'binance' },
  'dhan': { credentialServiceType: 'dhan', gatewaySource: 'dhan' },
  'schwab': { credentialServiceType: 'schwab', gatewaySource: 'schwab' },
};

/**
 * Get source mapping for a given source ID.
 * Maps frontend/control message source IDs to credential service types and gateway sources.
 * 
 * Examples:
 *   - 'binance_stream' → { credentialServiceType: 'binance', gatewaySource: 'binance' }
 *   - 'alpaca_news' → { credentialServiceType: 'alpaca', gatewaySource: 'alpaca_news' }
 *   - 'binance' → { credentialServiceType: 'binance', gatewaySource: 'binance' }
 */
export function getSourceMapping(source: string): SourceMapping {
  return SOURCE_MAPPING[source] || { 
    credentialServiceType: source, 
    gatewaySource: source as MarketSource 
  };
}
