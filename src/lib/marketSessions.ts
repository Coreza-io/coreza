/** Display markets only: choosing one never creates a market-data subscription. */
export const MARKET_CATALOG = [
  { id: 'nyse', name: 'NYSE', timezone: 'America/New_York' },
  { id: 'nasdaq', name: 'NASDAQ', timezone: 'America/New_York' },
  { id: 'nse', name: 'NSE', timezone: 'Asia/Kolkata' },
  { id: 'bse', name: 'BSE', timezone: 'Asia/Kolkata' },
  { id: 'crypto', name: 'Crypto', timezone: 'UTC' },
] as const;
export type MarketId = typeof MARKET_CATALOG[number]['id'];
export const DEFAULT_MARKETS: MarketId[] = ['nyse', 'nasdaq'];
export function normalizeMarkets(value: unknown): MarketId[] {
  if (value == null) return [...DEFAULT_MARKETS];
  if (!Array.isArray(value)) return [];
  return MARKET_CATALOG.filter(market => value.includes(market.id)).map(market => market.id);
}

/** No verified exchange-calendar coverage is bundled yet. Never guess from weekdays. */
export function marketSession(id: MarketId) {
  return id === 'crypto'
    ? { label: '24/7 schedule', description: 'Trading schedule only; not venue uptime or account connectivity.' }
    : { label: 'Schedule unavailable', description: 'A verified exchange calendar is not available. No open/closed status is inferred.' };
}
