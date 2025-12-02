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
  
  // Protocol flags
  isBinary?: boolean;                    // Uses binary WebSocket protocol (Dhan)
  requiresPreConnect?: boolean;          // Needs setup before connect (Schwab OAuth)
  preConnect?: (creds: any) => Promise<any>;  // Pre-connection setup hook
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
  
  alpaca_news: {
    id: 'alpaca_news',
    wsUrl: 'wss://stream.data.alpaca.markets/v1beta1/news',
    makeAuthMessage: (creds) => ({
      action: 'auth',
      key: creds.api_key,
      secret: creds.secret_key,
    }),
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
    wsUrl: 'wss://stream.binance.com:9443/ws',
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
