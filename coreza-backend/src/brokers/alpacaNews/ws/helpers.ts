import type { MarketEvent } from '../../../types/marketEvent';

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
    news: symbols.map(toAlpacaNewsSymbol),
  };
}

export function buildAlpacaNewsUnsubscribeMessage(symbols: string[]) {
  return {
    action: 'unsubscribe',
    news: symbols.map(toAlpacaNewsSymbol),
  };
}

function toAlpacaNewsSymbol(symbol: string): string {
  const upper = String(symbol || '').trim().toUpperCase();
  return upper.includes('/') ? upper.replace(/\//g, '') : upper;
}

function fromAlpacaNewsSymbol(symbol: string, assetType?: string): string {
  const upper = String(symbol || '').trim().toUpperCase();
  if (upper.includes('/')) return upper;
  if (assetType !== 'crypto' || upper.length <= 3) return upper;

  // Alpaca crypto symbols arrive as compact pairs (e.g. BTCUSD);
  // convert back to slash format for workflow/UI consistency.
  return `${upper.slice(0, -3)}/${upper.slice(-3)}`;
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
  const newsAssetType = msg.assetType || msg.asset_type;
  const mappedSymbols = Array.isArray(msg.symbols)
    ? msg.symbols.map((symbol: string) => fromAlpacaNewsSymbol(symbol, newsAssetType))
    : msg.symbols;

  return {
    source: 'alpaca_news' as const,
    symbol: mappedSymbols?.[0]?.toUpperCase() || '*',
    type: 'news' as const,
    t: msg.created_at ? new Date(msg.created_at).getTime() : Date.now(),
    headline: msg.headline,
    summary: msg.summary,
    author: msg.author,
    url: msg.url,
    symbols: mappedSymbols,
    newsSource: msg.source,
  } as MarketEvent;
}
