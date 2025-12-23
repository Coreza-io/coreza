import type { MarketEvent } from '../../types/marketEvent';

export function buildAlpacaNewsAuthMessage(creds: any) {
  return {
    action: 'auth',
    key: creds.api_key,
    secret: creds.secret_key,
  };
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

export function normalizeAlpacaNewsMessage(msg: any): MarketEvent | null {
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
  } as MarketEvent;
}
