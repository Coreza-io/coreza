import type { MarketEvent } from '../../../types/marketEvent';

export interface BinanceSubscribeOptions {
  klineInterval?: string;
  depthLevels?: string;
}

export function buildBinanceSubscribeMessage(
  symbols: string[],
  types: string[] = ['trade'],
  options?: BinanceSubscribeOptions
) {
  const params = symbols.flatMap((s) =>
    types.map((t) => {
      const sym = s.toLowerCase();
      if (t === 'kline' && options?.klineInterval) {
        return `${sym}@kline_${options.klineInterval}`;
      }
      if (t === 'depth' && options?.depthLevels) {
        return `${sym}@depth${options.depthLevels}`;
      }
      // ticker maps to 24hrTicker stream name in Binance
      if (t === 'ticker') {
        return `${sym}@ticker`;
      }
      return `${sym}@${t}`;
    })
  );
  return { method: 'SUBSCRIBE', params, id: Date.now() };
}

export function buildBinanceUnsubscribeMessage(
  symbols: string[],
  types: string[] = ['trade'],
  options?: BinanceSubscribeOptions
) {
  const params = symbols.flatMap((s) =>
    types.map((t) => {
      const sym = s.toLowerCase();
      if (t === 'kline' && options?.klineInterval) {
        return `${sym}@kline_${options.klineInterval}`;
      }
      if (t === 'depth' && options?.depthLevels) {
        return `${sym}@depth${options.depthLevels}`;
      }
      if (t === 'ticker') {
        return `${sym}@ticker`;
      }
      return `${sym}@${t}`;
    })
  );
  return { method: 'UNSUBSCRIBE', params, id: Date.now() };
}

export function parseBinanceMessage(buffer: Buffer): any[] {
  return [JSON.parse(buffer.toString())];
}

export function identifyBinanceMessageType(msg: any): string {
  return msg.e || (msg.result !== undefined ? 'result' : 'unknown');
}

export function shouldPublishBinanceMessage(msg: any): boolean {
  return [
    'trade',
    'aggTrade',
    'kline',
    'bookTicker',
    '24hrTicker',
    'miniTicker',
    'depthUpdate',
  ].includes(msg.e);
}

export function normalizeBinanceMessage(msg: any): MarketEvent | null {
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

    case 'aggTrade':
      return {
        symbol,
        t,
        p: parseFloat(msg.p),
        q: parseFloat(msg.q),
        type: 'aggTrade' as const,
        source: 'binance' as const,
        aggregateTradeId: msg.a,
        firstTradeId: msg.f,
        lastTradeId: msg.l,
        isBuyerMaker: msg.m,
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

    case 'miniTicker':
      return {
        symbol,
        t,
        c: parseFloat(msg.c),
        o: parseFloat(msg.o),
        h: parseFloat(msg.h),
        l: parseFloat(msg.l),
        v: parseFloat(msg.v),
        type: 'miniTicker' as const,
        source: 'binance' as const,
      };

    case 'depthUpdate':
      return {
        symbol,
        t,
        bids: msg.b?.map(([price, qty]: [string, string]) => ({
          p: parseFloat(price),
          q: parseFloat(qty),
        })),
        asks: msg.a?.map(([price, qty]: [string, string]) => ({
          p: parseFloat(price),
          q: parseFloat(qty),
        })),
        type: 'depth' as const,
        source: 'binance' as const,
      };

    default:
      return null;
  }
}
