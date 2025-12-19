/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { CorezaMarketEvent } from '../types/marketEvent';

export interface GatewayConfig<TSource extends string = string> {
  id: TSource;
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

const gatewayConfigs = {
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
            t: k.t,
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
            c: parseFloat(msg.c),
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

export const GATEWAY_CONFIGS = gatewayConfigs as {
  [K in keyof typeof gatewayConfigs]: GatewayConfig<K>;
};

export type MarketSource = keyof typeof GATEWAY_CONFIGS;

// ============================================================
// Source Mapping: Maps frontend/control message source IDs to gateway sources
// This consolidates the mapping previously in websockets.ts
// ============================================================

export interface SourceMapping {
  credentialServiceType: string;
  gatewaySource: MarketSource;
}

export const SOURCE_MAPPING: Record<string, SourceMapping> = Object.keys(GATEWAY_CONFIGS).reduce(
  (mapping, key) => {
    const base = key.split('_')[0];
    const gatewaySource = key as MarketSource;

    mapping[key] = { credentialServiceType: base, gatewaySource };

    if (key === base) {
      mapping[`${base}_stream`] = { credentialServiceType: base, gatewaySource };
    }

    return mapping;
  },
  {} as Record<string, SourceMapping>
);

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
