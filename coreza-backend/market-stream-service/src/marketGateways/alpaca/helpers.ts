import type { CorezaMarketEvent } from '../../types/marketEvent';

const ALPACA_TYPE_TO_KEY: Record<string, string> = {
  trade: 'trades',
  quote: 'quotes',
  bar: 'bars',
  daily_bar: 'dailyBars',
  trades: 'trades',
  quotes: 'quotes',
  bars: 'bars',
  dailyBars: 'dailyBars',
};

export function buildAlpacaAuthMessage(creds: any) {
  return {
    action: 'auth',
    key: creds.api_key,
    secret: creds.secret_key,
  };
}

export function isAlpacaAuthSuccess(msg: any): boolean {
  return Array.isArray(msg) ? msg.some((m) => m.T === 'success') : msg.T === 'success';
}

export function isAlpacaAuthError(msg: any): boolean {
  return Array.isArray(msg) ? msg.some((m) => m.T === 'error') : msg.T === 'error';
}

export function handleAlpacaControlMessage(msg: any, logger: any) {
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
}

export function buildAlpacaSubscribeMessage(symbols: string[], types: string[] = ['trade']) {
  const msg: any = { action: 'subscribe' };
  types.forEach((t) => {
    const key = ALPACA_TYPE_TO_KEY[t] || `${t}s`;
    msg[key] = symbols;
  });
  return msg;
}

export function buildAlpacaUnsubscribeMessage(symbols: string[], types: string[] = ['trade']) {
  const msg: any = { action: 'unsubscribe' };
  types.forEach((t) => {
    const key = ALPACA_TYPE_TO_KEY[t] || `${t}s`;
    msg[key] = symbols;
  });
  return msg;
}

export function parseAlpacaMessage(buffer: Buffer): any[] {
  const parsed = JSON.parse(buffer.toString());
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function identifyAlpacaMessageType(msg: any): string {
  return msg.T;
}

export function shouldPublishAlpacaMessage(msg: any): boolean {
  return ['t', 'q', 'b', 'd'].includes(msg.T);
}

export function normalizeAlpacaMessage(msg: any): CorezaMarketEvent | null {
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
        x: msg.x,
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
        A: msg.as,
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
        timeframe: '1m',
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
        timeframe: '1d',
      };
    default:
      return null;
  }
}
