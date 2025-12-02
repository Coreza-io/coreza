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
      const symbol = msg.S?.toUpperCase();
      const date = msg.t ? new Date(msg.t).toISOString() : new Date().toISOString();
      
      switch (msg.T) {
        case 't': 
          return { 
            source: 'alpaca' as const, 
            symbol, 
            date, 
            type: 'trade' as const, 
            price: msg.p, 
            quantity: msg.s, 
            exchange: msg.x 
          };
        case 'q': 
          return { 
            source: 'alpaca' as const, 
            symbol, 
            date, 
            type: 'quote' as const, 
            bidPrice: msg.bp, 
            bidQuantity: msg.bs, 
            askPrice: msg.ap, 
            askQuantity: msg.as 
          };
        case 'b': 
          return { 
            source: 'alpaca' as const, 
            symbol, 
            date, 
            type: 'bar' as const, 
            open: msg.o, 
            high: msg.h, 
            low: msg.l, 
            close: msg.c, 
            volume: msg.v, 
            vwap: msg.vw, 
            timeframe: '1m' 
          };
        case 'd': 
          return { 
            source: 'alpaca' as const, 
            symbol, 
            date, 
            type: 'daily_bar' as const, 
            open: msg.o, 
            high: msg.h, 
            low: msg.l, 
            close: msg.c, 
            volume: msg.v, 
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
        date: msg.created_at || new Date().toISOString(),
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
      const date = new Date(msg.E || msg.T || Date.now()).toISOString();

      switch (msg.e) {
        case 'trade':
          return {
            symbol,
            date,
            price: parseFloat(msg.p),
            quantity: parseFloat(msg.q),
            type: 'trade' as const,
            source: 'binance' as const,
          };

        case 'kline': {
          const k = msg.k;
          return {
            symbol,
            date,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            timeframe: k.i,
            isClosed: k.x,
            type: 'bar' as const,
            source: 'binance' as const,
          };
        }

        case 'bookTicker':
          return {
            symbol,
            date,
            bidPrice: parseFloat(msg.b),
            bidQuantity: parseFloat(msg.B),
            askPrice: parseFloat(msg.a),
            askQuantity: parseFloat(msg.A),
            type: 'quote' as const,
            source: 'binance' as const,
          };

        case '24hrTicker':
          return {
            symbol,
            date,
            price: parseFloat(msg.c),
            priceChange: parseFloat(msg.p),
            priceChangePercent: parseFloat(msg.P),
            volume: parseFloat(msg.v),
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
        date: new Date().toISOString(),
        price: msg.LTP,
        bidPrice: msg.BidPrice,
        bidQuantity: msg.BidQty,
        askPrice: msg.AskPrice,
        askQuantity: msg.AskQty,
        open: msg.Open,
        high: msg.High,
        low: msg.Low,
        close: msg.Close,
        volume: msg.Volume,
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
        date: new Date().toISOString(),
        price: content['3'],
        bidPrice: content['1'],
        bidQuantity: content['4'],
        askPrice: content['2'],
        askQuantity: content['5'],
        open: content['28'],
        high: content['12'],
        low: content['13'],
        close: content['15'],
        volume: content['8'],
      };
    },
    
    reconnectDelay: 2000,
    maxReconnectAttempts: 5,
    requiresPreConnect: true,
  },
};
