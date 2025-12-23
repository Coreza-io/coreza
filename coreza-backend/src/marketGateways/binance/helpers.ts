import type { MarketEvent } from '../../types/marketEvent';

export function buildBinanceSubscribeMessage(symbols: string[], types: string[] = ['trade']) {
  return {
    method: 'SUBSCRIBE',
    params: symbols.flatMap((s) => types.map((t) => `${s.toLowerCase()}@${t}`)),
    id: Date.now(),
  };
}

export function buildBinanceUnsubscribeMessage(symbols: string[], types: string[] = ['trade']) {
  return {
    method: 'UNSUBSCRIBE',
    params: symbols.flatMap((s) => types.map((t) => `${s.toLowerCase()}@${t}`)),
    id: Date.now(),
  };
}

export function parseBinanceMessage(buffer: Buffer): any[] {
  return [JSON.parse(buffer.toString())];
}

export function identifyBinanceMessageType(msg: any): string {
  return msg.e || (msg.result !== undefined ? 'result' : 'unknown');
}

export function shouldPublishBinanceMessage(msg: any): boolean {
  return ['trade', 'kline', 'bookTicker', '24hrTicker'].includes(msg.e);
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
}
