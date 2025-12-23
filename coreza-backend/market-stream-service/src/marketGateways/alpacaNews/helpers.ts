import type { CorezaMarketEvent } from '../../types/marketEvent';

export function buildAlpacaNewsAuthMessage(creds: any) {
  return {
    action: 'auth',
    key: creds.api_key,
    secret: creds.secret_key,
  };
}

export function isAlpacaNewsAuthSuccess(msg: any): boolean {
  return Array.isArray(msg) ? msg.some((m) => m.T === 'success') : msg.T === 'success';
}

export function isAlpacaNewsAuthError(msg: any): boolean {
  return Array.isArray(msg) ? msg.some((m) => m.T === 'error') : msg.T === 'error';
}

export function handleAlpacaNewsControlMessage(msg: any, logger: any) {
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
}

export function buildAlpacaNewsSubscribeMessage(symbols: string[]) {
  return {
    action: 'subscribe',
    news: symbols,
  };
}

export function buildAlpacaNewsUnsubscribeMessage(symbols: string[]) {
  return {
    action: 'unsubscribe',
    news: symbols,
  };
}

export function parseAlpacaNewsMessage(buffer: Buffer): any[] {
  const parsed = JSON.parse(buffer.toString());
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function identifyAlpacaNewsMessageType(msg: any): string {
  return msg.T;
}

export function shouldPublishAlpacaNewsMessage(msg: any): boolean {
  return msg.T === 'n';
}

export function normalizeAlpacaNewsMessage(msg: any): CorezaMarketEvent | null {
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
  } as CorezaMarketEvent;
}
