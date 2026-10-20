import { BACKTEST_PROVIDERS } from '../workflow/nodeRoles';

const OPTIONS: Record<string, string[]> = {
  alpaca: ['currency'], binance: ['marketType'],
  dhan: ['exchangeSegment', 'instrument', 'expiryCode', 'oi'],
  schwab: ['needExtendedHoursData'],
};
export function historicalProvider(name: string): string | undefined { return Object.prototype.hasOwnProperty.call(BACKTEST_PROVIDERS, name) ? BACKTEST_PROVIDERS[name] : undefined; }
export function normalizeHistoricalConfiguration(provider: string, values: Record<string, any>) {
  if (!Object.prototype.hasOwnProperty.call(OPTIONS, provider)) throw new Error(`Unsupported historical provider: ${provider}`);
  if (values.operation !== 'get_candle' && !(provider === 'schwab' && values.operation === 'get_price_history')) {
    throw new Error('Configure a historical operation on the attached broker.');
  }
  const assetType = provider === 'binance' ? values.marketType : values.assetType ?? values.asset_type;
  const rawSymbols = values.symbol || values.symbols || (values.crypto_base && values.crypto_quote ? `${values.crypto_base}/${values.crypto_quote}` : '');
  const symbols: string[] = [...new Set<string>((Array.isArray(rawSymbols) ? rawSymbols : String(rawSymbols).split(',')).map((s: any) => String(s).trim()).filter(Boolean))];
  let interval = String(values.interval || '');
  if (provider === 'schwab' && !interval) {
    const unit: Record<string, string> = {minute: 'Min', daily: 'Day', weekly: 'Week', monthly: 'Month'};
    interval = `${values.frequency || 1}${unit[values.frequencyType || 'minute'] || ''}`;
  }
  const validInterval = provider === 'binance' ? /^(1s|[135]m|15m|30m|[12468]h|12h|[13]d|1w|1M)$/ : provider === 'dhan' ? /^(1|5|15|25|60|1Day|Day)$/ : provider === 'schwab' ? /^(1|5|10|15|30)(Min|m|min)$|^1(Day|d|day|Week|w|week|Month|mo|month)$/ : /^(\d+)(Min|Hour|Day|Week|Month)$/;
  if (!validInterval.test(interval)) throw new Error(`Interval ${interval} is not valid for ${provider} historical data.`);
  let start = values.start || values.start_date || values.startTime || values.startDate;
  let end = values.end || values.end_date || values.endTime || values.endDate;
  if (provider === 'dhan' && (!start || !end) && Number(values.lookback) > 0) {
    const now = new Date(); const from = new Date(now);
    if (Number(interval) > 0) from.setMinutes(now.getMinutes() - Number(values.lookback) * Number(interval));
    else from.setDate(now.getDate() - Number(values.lookback));
    const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0,19).replace('T', ' ');
    start ||= local(from); end ||= local(now);
  }
  const epoch = (v: any): number => typeof v === 'number' || /^\d{10,13}$/.test(String(v)) ? Number(v) * (Number(v) < 1e12 ? 1000 : 1) : Date.parse(v);
  if (!symbols.length || symbols.length > 100 || symbols.some(s => s.length > 80) || !start || !end || !Number.isFinite(epoch(start)) || !Number.isFinite(epoch(end)) || epoch(start) >= epoch(end)) {
    throw new Error('Configure symbols, interval, and a valid date range on the attached broker.');
  }
  if (typeof start === 'number' || /^\d{10,13}$/.test(String(start))) start = new Date(epoch(start)).toISOString();
  if (typeof end === 'number' || /^\d{10,13}$/.test(String(end))) end = new Date(epoch(end)).toISOString();
  if (!values.credential_id || typeof values.credential_id !== 'string') throw new Error('Choose a credential on the attached broker.');
  const relevant = [rawSymbols, interval, start, end, values.credential_id, assetType, values.feed, values.adjustment, ...OPTIONS[provider].map(k => values[k])];
  if (JSON.stringify(relevant).includes('{{')) throw new Error('Resolve all historical broker references before initialization.');
  for (const option of relevant.flat()) {
    if (option != null && (!['string','number','boolean'].includes(typeof option) || String(option).length > 2000)) throw new Error('Invalid historical broker option.');
  }
  if (provider === 'alpaca' && assetType && !['stock','crypto'].includes(assetType)) throw new Error('Choose stock or crypto historical data.');
  if (provider === 'binance' && assetType && !['spot','futures'].includes(assetType)) throw new Error('Choose spot or futures historical data.');
  const providerOptions = Object.fromEntries(OPTIONS[provider].filter(k => values[k] !== undefined).map(k => [k, values[k]]));
  return Object.freeze({provider, credentialId: values.credential_id as string, symbols: Object.freeze(symbols), interval, start: String(start), end: String(end), assetType, feed: values.feed, adjustment: values.adjustment, providerOptions: Object.freeze(providerOptions)});
}
/** Only this allowlist is forwarded to the canonical historical operation. */
export function historicalRequestInput(request: any): Record<string, any> {
  return {
    ...request.providerOptions, operation: 'get_candle', credential_id: request.credentialId,
    symbol: request.symbol, interval: request.interval,
    start: request.start, end: request.end,
    ...(request.provider === 'binance' ? {startTime: request.start, endTime: request.end, marketType: request.assetType} : {}),
    assetType: request.assetType, asset_type: request.assetType,
    feed: request.feed, adjustment: request.adjustment,
    // Saved UI page/limit/sort settings cannot truncate a simulation range.
    sort: 'asc', auto_paginate: true, limit: request.provider === 'binance' ? 1000 : 10000,
  };
}

/** Legacy conversion is explicit and shared with the editor migration. */
export function legacyHistoricalValues(provider: string, legacy: Record<string, any>): Record<string, any> {
  const common = {operation: provider === 'schwab' ? 'get_price_history' : 'get_candle', credential_id: legacy.credential_id, symbol: legacy.symbols || legacy.symbol, interval: legacy.interval, assetType: legacy.asset_type, feed: legacy.feed, adjustment: legacy.adjustment};
  if (provider === 'binance') return {...common, marketType: legacy.asset_type || 'spot', startTime: legacy.start_date, endTime: legacy.end_date};
  return {...common, start: legacy.start_date, end: legacy.end_date};
}
