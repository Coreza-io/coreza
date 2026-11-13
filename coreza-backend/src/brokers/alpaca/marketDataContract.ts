import { z } from 'zod';
import { ToolInputError, type ToolInputContract, type ToolInputIssue } from '../../nodes/logic/toolInputContract';
import { validateAlpacaCryptoSymbol } from './cryptoOrderSymbol';
import { extractHistoricalCandles, normalizeCandles } from '../../marketData/normalizeCandles';

const historicalFeeds = ['sip', 'iex', 'otc', 'boats'];
const latestFeeds = [...historicalFeeds, 'delayed_sip', 'overnight'];
const intervals = ['1Min', '5Min', '15Min', '1Hour', '1Day'];
const adjustments = ['raw', 'split', 'dividend', 'spin-off', 'all'];
const own = (object: any, key: string) => Object.prototype.hasOwnProperty.call(object ?? {}, key);
const present = (value: any) => value !== undefined && value !== null && value !== '';
const fields = new Set(['operation', 'assetType', 'asset_type', 'symbol', 'symbols', 'crypto_base', 'interval', 'limit', 'start', 'end', 'feed', 'sort', 'adjustment', 'currency', 'page_token', 'auto_paginate', 'max_pages']);

/** Calendar validation is separate from parsing; preserve the original timestamp and precision. */
function validDate(value: any): boolean {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, zone] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  if (m < 1 || m > 12 || d < 1 || d > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]) return false;
  if (hour && (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59)) return false;
  if (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function dateAfter(start: string, end: string): boolean {
  const parts = (value: string) => ({
    time: Date.parse(value.replace(/\.\d+(?=Z|[+-])/, '')),
    fraction: /\.(\d+)(?:Z|[+-])/.exec(value)?.[1] ?? '',
  });
  const a = parts(start), b = parts(end);
  const length = Math.max(a.fraction.length, b.fraction.length);
  return a.time > b.time || a.time === b.time && a.fraction.padEnd(length, '0') > b.fraction.padEnd(length, '0');
}

export function validateAlpacaMarketData(input: Record<string, any>, configured?: Record<string, any>, raw?: any): Record<string, any> {
  const values = { ...input };
  for (const key of ['asset_type', 'symbols', 'crypto_base', 'symbol']) {
    if (raw && own(raw, key) && !own(configured, key)) values[key] = raw[key];
  }
  const issues: ToolInputIssue[] = [];
  const issue = (field: string, code: string, message: string) => {
    const fixed = own(configured, field);
    issues.push({ field, code, message, source: fixed ? 'configuration' : raw && own(raw, field) ? 'model' : 'default', editable: !fixed });
  };
  const alias = (canonical: string, keys: string[], fallback?: any) => {
    const fixed = keys.filter(key => own(configured, key));
    const supplied = keys.filter(key => raw && own(raw, key));
    const candidates = fixed.length ? fixed : supplied.length ? supplied : keys.filter(key => present(values[key]));
    const comparable = (value: any) => typeof value === 'string' ? value.trim().toUpperCase()
      : Array.isArray(value) && value.every(item => typeof item === 'string') ? value.join(',').toUpperCase() : value;
    if (candidates.length > 1 && candidates.some(key => comparable(values[key]) !== comparable(values[candidates[0]]))) {
      issue(candidates[0], 'conflicting_aliases', 'Provide one consistent value for aliases');
    }
    values[canonical] = candidates.length ? values[candidates[0]] : fallback;
    return candidates[0] ?? canonical;
  };
  const assetField = alias('assetType', ['assetType', 'asset_type'], 'stock');
  if (!['stock', 'crypto'].includes(values.assetType)) issue(assetField, 'invalid_asset', 'assetType must be stock or crypto');
  delete values.asset_type;
  const crypto = values.assetType === 'crypto';
  // crypto_base is the active editor field. A hidden saved stock symbol cannot conflict with it.
  const hasExplicitPairAlias = ['symbol', 'symbols'].some(key =>
    (own(configured, 'crypto_base') ? own(configured, key) : raw === undefined) &&
    (typeof values[key] === 'string' ? values[key].includes('/') : Array.isArray(values[key])));
  const cryptoFieldIsAuthoritative = (own(configured, 'crypto_base') || raw === undefined && present(values.crypto_base)) && !hasExplicitPairAlias;
  const symbolField = alias('symbol', crypto ? cryptoFieldIsAuthoritative ? ['crypto_base'] : ['crypto_base', 'symbol', 'symbols'] : ['symbol', 'symbols']);
  let symbols: string[] = [];
  if (raw === undefined && Array.isArray(values.symbol) && values.symbol.every((symbol: any) => typeof symbol === 'string')) values.symbol = values.symbol.join(',');
  if (typeof values.symbol === 'string') symbols = values.symbol.split(',').map((symbol: string) => symbol.trim());
  if (!symbols.length || symbols.some(symbol => !symbol) || (raw !== undefined && symbols.length !== 1)) issue(symbolField, 'invalid_symbol', 'Provide one symbol per agent market-data call');
  try {
    values.symbol = symbols.map(symbol => crypto ? validateAlpacaCryptoSymbol(symbol) : symbol.toUpperCase()).join(',');
  } catch { issue(symbolField, 'invalid_crypto_pair', 'Provide a full crypto pair such as ETH/USD'); }
  if (crypto) values.crypto_base = values.symbol;
  delete values.symbols;
  const historical = values.operation === 'get_candle';
  const ignored = historical ? (crypto ? ['feed', 'adjustment', 'currency'] : [])
    : ['interval', 'start', 'end', 'limit', 'sort', 'adjustment', 'auto_paginate', 'max_pages', 'page_token', ...(crypto ? ['feed', 'currency'] : [])];
  for (const key of ignored) {
    if (raw && own(raw, key) && !own(configured, key)) issue(key, 'inactive_parameter', 'Parameter is not supported for the selected operation and asset');
    delete values[key];
  }
  for (const key of Object.keys(raw ?? {})) {
    if (!fields.has(key)) issue(key, 'unknown_parameter', key === 'timeframe' ? 'Use interval instead of timeframe' : 'Unknown market-data parameter; use the exposed tool fields');
  }
  if (!crypto && present(values.feed) && !(historical ? historicalFeeds : latestFeeds).includes(values.feed)) {
    issue('feed', 'invalid_feed', `feed must be one of ${(historical ? historicalFeeds : latestFeeds).join(', ')}`);
  }
  const integer = (key: string, maximum: number, fallback: number) => {
    const value = values[key];
    if (!present(value) || (typeof value === 'string' && !value.trim())) {
      if (own(configured, key)) issue(key, 'invalid_positive_integer', `${key} must resolve to an integer from 1 through ${maximum}`);
      else values[key] = fallback;
      return;
    }
    const numeric = typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()));
    if (!numeric || !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum) {
      issue(key, 'invalid_positive_integer', `${key} must be an integer from 1 through ${maximum}`);
    } else values[key] = Number(value);
  };
  for (const key of ['currency', 'page_token']) {
    if (present(values[key]) && (typeof values[key] !== 'string' || !values[key].trim())) issue(key, 'invalid_string', `${key} must be a non-empty string`);
  }
  if (historical) {
    if (!intervals.includes(values.interval)) issue('interval', 'invalid_interval', `interval must be one of ${intervals.join(', ')}`);
    integer('limit', 10000, 1000);
    integer('max_pages', 100, 100);
    if (values.auto_paginate === undefined && !own(configured, 'auto_paginate')) values.auto_paginate = true;
    else if (typeof values.auto_paginate !== 'boolean') issue('auto_paginate', 'invalid_boolean', 'auto_paginate must be a boolean');
    for (const key of ['start', 'end']) {
      if (values[key] === '') delete values[key];
      if (present(values[key]) && !validDate(values[key])) issue(key, 'invalid_date', 'Use a valid YYYY-MM-DD date or RFC-3339 timestamp with timezone');
    }
    if (validDate(values.start) && validDate(values.end) && dateAfter(values.start, values.end)) {
      issue(own(configured, 'end') && !own(configured, 'start') ? 'start' : 'end', 'invalid_range', 'end must be at or after start');
    }
    if (!['asc', 'desc'].includes(values.sort ?? 'asc')) issue('sort', 'invalid_sort', 'sort must be asc or desc');
    if (!crypto && !present(values.adjustment)) values.adjustment = 'raw';
    if (!crypto && present(values.adjustment)) {
      if (typeof values.adjustment !== 'string' || !values.adjustment.split(',').every((token: string) => adjustments.includes(token.trim()))) {
        issue('adjustment', 'invalid_adjustment', 'Use raw, split, dividend, spin-off, all, or a comma-separated combination');
      } else values.adjustment = values.adjustment.split(',').map((token: string) => token.trim()).join(',');
    }
  }
  if (issues.length) throw new ToolInputError(issues);
  return values;
}

export const alpacaMarketDataContract: ToolInputContract = {
  id: 'alpaca.market-data.v1',
  risk: 'read-only',
  instructions: 'For historical bars, limit is page size, not the latest N bars. Use interval, not timeframe. Select one symbol per agent call. Explicit feeds and date ranges are preserved.',
  supports: operation => operation === 'get_candle' || operation === 'get_latest_bar',
  schema: (shape, configured) => {
    if (configured.operation && !alpacaMarketDataContract.supports(configured.operation)) return shape;
    const result = { ...shape };
    delete result.dataRef; // These endpoints fetch data; they do not consume historical references.
    // Aliases are accepted by the runtime contract; canonical requirements apply after resolution.
    for (const key of ['symbol', 'crypto_base', 'assetType']) if (result[key]) result[key] = z.string().optional();
    // Scalar semantics run after configuration resolution, without lossy coercion.
    for (const key of ['limit', 'max_pages']) if (key in result || (!configured.operation || configured.operation === 'get_candle') && key === 'max_pages') {
      if (!own(configured, key)) result[key] = z.union([z.number(), z.string()]).optional().describe(`${key} is a positive integer; limit is page size, max_pages is at most 100`);
    }
    if (!own(configured, 'auto_paginate') && (!configured.operation || configured.operation === 'get_candle')) result.auto_paginate = z.boolean().optional();
    if (result.adjustment) result.adjustment = z.string().optional().describe('Corporate-action adjustment; comma-separated combinations are supported');
    return result;
  },
  argumentIssues: raw => Object.keys(raw && typeof raw === 'object' ? raw : {}).filter(key => !fields.has(key)).map(field => ({
    field, code: 'unknown_parameter', source: 'model', editable: true,
    message: field === 'timeframe' ? 'Use interval instead of timeframe' : 'Unknown market-data parameter; use the exposed tool fields',
  })),
  validate: validateAlpacaMarketData,
  output: (output, input) => {
    const latest = input.operation === 'get_latest_bar';
    const requested = { ...input, ...(latest ? { interval: '1Min' } : {}) };
    const series = extractHistoricalCandles(output, { symbol: input.symbol, timeframe: requested.interval, assetType: input.assetType });
    const bars = latest ? normalizeCandles(series.bars) : series.bars;
    const complete = output.pagination_complete ?? !output.has_more;
    // Historical input can be descending; summaries describe chronological bounds, like the stored DataRef.
    let firstTime: number | undefined, lastTime: number | undefined;
    for (const bar of bars) {
      firstTime = firstTime === undefined ? bar.time : Math.min(firstTime, bar.time);
      lastTime = lastTime === undefined ? bar.time : Math.max(lastTime, bar.time);
    }
    const summary = { symbol: input.symbol, assetType: input.assetType, timeframe: requested.interval,
      feed: input.feed ?? null, adjustment: input.adjustment ?? null, currency: input.currency ?? null,
      requestedRange: { start: input.start ?? null, end: input.end ?? null },
      rangeSource: input.start && input.end ? 'explicit' : input.start || input.end ? 'mixed' : 'provider_defaults',
      pageSize: input.limit, pagesFetched: output.pages_fetched ?? 1, paginationComplete: complete,
      hasMore: !!output.has_more, returnedBarCount: bars.length,
      firstTimestamp: firstTime !== undefined ? new Date(firstTime).toISOString() : null,
      lastTimestamp: lastTime !== undefined ? new Date(lastTime).toISOString() : null };
    if (!bars.length || latest) return { input: requested, summary,
      result: { success: bars.length > 0, ...(!bars.length ? { status: complete ? 'no_data' as const : 'partial_data' as const } : {}),
        type: 'market_data', cached: false, rowCount: bars.length,
        summary: { ...summary, ...(latest && bars.length ? { bar: bars[bars.length - 1] } : {}),
          ...(!bars.length ? { message: complete ? 'No bars returned. Check the requested session and feed coverage.' : 'Page limit reached; coverage is incomplete.' } : {}) } } };
    return { input: requested, summary };
  },
};
