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
      // Alpaca sends [{ T: 'success', msg: 'authenticated' }]
      return Array.isArray(msg) ? msg.some(m => m.T === 'success') : msg.T === 'success';
    },
    isAuthError: (msg) => {
      // Alpaca sends [{ T: 'error', msg: '...', code: ... }]
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
        const key = ALPACA_TYPE_TO_KEY[t] || `${t}s`;  // Map singular → plural
        msg[key] = symbols;
      });
      return msg;
    },
    makeUnsubscribeMessage: (symbols, types = ['trade']) => {
      const msg: any = { action: 'unsubscribe' };
      types.forEach(t => {
        const key = ALPACA_TYPE_TO_KEY[t] || `${t}s`;  // Map singular → plural
        msg[key] = symbols;
      });
      return msg;
    },
    parseMessage: (buffer) => {
      const parsed = JSON.parse(buffer.toString());
      // Alpaca wraps messages in array
      return Array.isArray(parsed) ? parsed : [parsed];
    },
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
        ts: msg.created_at || new Date().toISOString(),
        raw: {
          id: msg.id,
          headline: msg.headline,
          summary: msg.summary,
          author: msg.author,
          url: msg.url,
          symbols: msg.symbols,
          source: msg.source,
          created_at: msg.created_at,
          updated_at: msg.updated_at,
          content: msg.content,
        },
      };
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
          ? 'wss://stream.binancefuture.com/ws'
          : 'wss://fstream.binance.com/ws';
      }

      return isTestnet
        ? 'wss://testnet.binance.vision/ws'
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
      const base = {
        source: 'binance' as const,
        symbol: msg.s?.toUpperCase(),
        ts: new Date(msg.E || msg.T || Date.now()).toISOString(),
        raw: msg,
      };

      switch (msg.e) {
        case 'trade':
          return { ...base, type: 'trade' as const, lastPrice: parseFloat(msg.p), size: parseFloat(msg.q) };

        case 'kline': {
          const k = msg.k;
          return {
            ...base,
            type: 'bar' as const,
            o: parseFloat(k.o),
            h: parseFloat(k.h),
            l: parseFloat(k.l),
            c: parseFloat(k.c),
            v: parseFloat(k.v),
            timeframe: k.i,
            isClosed: k.x,
          };
        }

        case 'bookTicker':
          return {
            ...base,
            type: 'quote' as const,
            bid: parseFloat(msg.b),
            bidSize: parseFloat(msg.B),
            ask: parseFloat(msg.a),
            askSize: parseFloat(msg.A),
          };

        case '24hrTicker':
          return {
            ...base,
            type: 'ticker' as const,
            lastPrice: parseFloat(msg.c),
            priceChange: parseFloat(msg.p),
            priceChangePercent: parseFloat(msg.P),
            v: parseFloat(msg.v),
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
    
    // No separate auth message - auth is in URL
    makeAuthMessage: undefined,
    
    makeSubscribeMessage: (symbols, types = ['ticker']) => {
      // Returns binary buffer via encoder
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
        ts: new Date().toISOString(),
        lastPrice: msg.LTP,
        bid: msg.BidPrice,
        bidSize: msg.BidQty,
        ask: msg.AskPrice,
        askSize: msg.AskQty,
        o: msg.Open,
        h: msg.High,
        l: msg.Low,
        c: msg.Close,
        v: msg.Volume,
        raw: msg,
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
    
    // Pre-connect: Fetch streaming URL from OAuth'd session
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
        ts: new Date().toISOString(),
        lastPrice: content['3'],
        bid: content['1'],
        bidSize: content['4'],
        ask: content['2'],
        askSize: content['5'],
        o: content['28'],
        h: content['12'],
        l: content['13'],
        c: content['15'],
        v: content['8'],
        raw: msg,
      };
    },
    
    reconnectDelay: 2000,
    maxReconnectAttempts: 5,
    requiresPreConnect: true,
  },
};
