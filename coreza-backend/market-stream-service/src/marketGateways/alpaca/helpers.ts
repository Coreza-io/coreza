import type { CorezaMarketEvent } from '../../types/marketEvent';

// ============ TYPE MAPPING ============
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

// ============ URL BUILDER (source-aware) ============
export function getAlpacaWsUrl(creds: any, source?: string): string {
  if (source === 'alpaca_news') {
    return 'wss://stream.data.alpaca.markets/v1beta1/news';
  }
  // Default: market data stream
  const feed = creds.feed || 'iex';
  return `wss://stream.data.alpaca.markets/v2/${feed}`;
}

// ============ AUTH (shared - identical for both) ============
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

// ============ STREAM NAME PARSING ============
// Alpaca stream names: "bars.AAPL", "trades.MSFT", "news.AAPL"
export function parseAlpacaStreamNames(streamNames: string[]): { symbols: string[]; types: string[] } {
  const symbols = new Set<string>();
  const types = new Set<string>();

  for (const name of streamNames) {
    const dotIndex = name.indexOf('.');
    if (dotIndex > 0) {
      const type = name.substring(0, dotIndex);
      const symbol = name.substring(dotIndex + 1);
      types.add(type);
      symbols.add(symbol);
    } else {
      // Fallback: treat as symbol with default type
      symbols.add(name);
      types.add('trades');
    }
  }

  return {
    symbols: Array.from(symbols),
    types: Array.from(types),
  };
}

// ============ SUBSCRIBE/UNSUBSCRIBE (stream-name based) ============
export function buildAlpacaSubscribeMessage(streamNames: string[], source?: string) {
  // NEWS source: subscribe to news stream
  if (source === 'alpaca_news') {
    const { symbols } = parseAlpacaStreamNames(streamNames);
    return { action: 'subscribe', news: symbols };
  }

  // STREAM source (default): parse stream names and build message
  const { symbols, types } = parseAlpacaStreamNames(streamNames);
  const msg: any = { action: 'subscribe' };
  types.forEach((t) => {
    const key = ALPACA_TYPE_TO_KEY[t] || t;
    msg[key] = symbols;
  });
  return msg;
}

export function buildAlpacaUnsubscribeMessage(streamNames: string[], source?: string) {
  if (source === 'alpaca_news') {
    const { symbols } = parseAlpacaStreamNames(streamNames);
    return { action: 'unsubscribe', news: symbols };
  }

  const { symbols, types } = parseAlpacaStreamNames(streamNames);
  const msg: any = { action: 'unsubscribe' };
  types.forEach((t) => {
    const key = ALPACA_TYPE_TO_KEY[t] || t;
    msg[key] = symbols;
  });
  return msg;
}

// ============ MESSAGE PARSING (shared) ============
export function parseAlpacaMessage(buffer: Buffer): any[] {
  const parsed = JSON.parse(buffer.toString());
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function identifyAlpacaMessageType(msg: any): string {
  return msg.T;
}

// ============ PUBLISH FILTER (source-aware) ============
export function shouldPublishAlpacaMessage(msg: any, source?: string): boolean {
  if (source === 'alpaca_news') {
    return msg.T === 'n'; // News messages
  }
  return ['t', 'q', 'b', 'd'].includes(msg.T); // Market data messages
}

// ============ CONTROL MESSAGES (source-aware for logging) ============
export function handleAlpacaControlMessage(msg: any, logger: any, source?: string) {
  const logSource = source || 'alpaca';
  const messages = Array.isArray(msg) ? msg : [msg];
  for (const m of messages) {
    if (m.T === 'subscription') {
      logger.info({ source: logSource, subscriptions: m }, 'Subscription confirmation received');
    } else if (m.T === 'error') {
      logger.error({ source: logSource, error: m }, 'Error message received');
    } else if (m.T === 'success') {
      logger.info({ source: logSource, msg: m.msg }, 'Success message received');
    }
  }
}

// ============ NORMALIZATION (source-aware) ============
export function normalizeAlpacaMessage(msg: any, source?: string): CorezaMarketEvent | null {
  // NEWS source
  if (source === 'alpaca_news') {
    if (msg.T !== 'n') return null;
    return {
      source: 'alpaca_news' as any,
      symbol: msg.symbols?.[0]?.toUpperCase() || '*',
      type: 'news' as const,
      t: msg.created_at ? new Date(msg.created_at).getTime() : Date.now(),
      headline: msg.headline,
      summary: msg.summary,
      author: msg.author,
      url: msg.url,
      symbols: msg.symbols,
      newsSource: msg.source,
    } as CorezaMarketEvent;
  }

  // STREAM source (default) - market data
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
