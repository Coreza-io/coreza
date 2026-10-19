/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { DataContext } from '../../engine';
import { randomUUID } from 'crypto';
import { extractHistoricalCandles, normalizeCandles } from '../../marketData/normalizeCandles';
import { getMarketDataNodeNames, getScreenerNodeNames, getTradeNodeNames } from '../../brokers/capabilities';

/**
 * Processed output that's safe for AI agents
 * Contains either a dataRef for large data or the summary directly
 */
export interface ProcessedToolOutput {
  success?: boolean;
  status?: 'not_ready' | 'no_data';
  /** Reference to data stored in InMemoryStore (for large datasets) */
  dataRef?: string;
  /** Summary data safe for AI consumption */
  summary: any;
  /** Number of rows if applicable */
  rowCount?: number;
  /** Whether data was stored/cached */
  cached: boolean;
  /** Original data type */
  type?: string;
}

/**
 * Summary for market data - what the AI sees instead of raw bars
 */
export interface MarketDataSummary {
  symbol: string;
  timeframe?: string;
  source?: string;
  rows: number;
  dateRange?: {
    start: string;
    end: string;
  };
  firstBar?: {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  };
  lastBar?: {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  };
  priceChange?: number;
  priceChangePercent?: number;
  avgVolume?: number;
  high52Week?: number;
  low52Week?: number;
}

/**
 * Nodes that return large market data arrays (auto-generated from capabilities + static)
 */
const MARKET_DATA_NODES = [
  'Market',
  'YahooFinance',
  'Polygon',
  'FinnHub',
  ...getMarketDataNodeNames(),
];

/**
 * Nodes that return computed indicator results (already summarized)
 */
const INDICATOR_NODES = [
  'RSI',
  'EMA',
  'SMA',
  'MACD',
  'BB',
  'ADX',
  'ATR',
  'Stoch',
  'VWAP',
  'OBV',
  'Ichimoku',
  'VolumeOscillator',
  'SupportResistance',
  'InitializeIndicators',
];

const SCREENER_NODES = [
  'YahooFinanceScreener',
  ...getScreenerNodeNames(),
];

const TRADE_NODES = [
  ...getTradeNodeNames(),
];

/**
 * Extract bars array from various output formats
 */
export type MarketDataTrace = (phase: string, metrics: Record<string, unknown>) => void;

/** Owned by one agent invocation, including failed and in-flight tool calls. */
export class ToolInvocationRefs {
  private aliases = new Map<string, Set<string>>();
  private outputs = new Map<string, string>();
  private metadata = new Map<string, { symbol?: string; timeframe?: string }>();
  readonly validatedBars = new WeakSet<any[]>();

  hasAlias(ref: string): boolean { return this.aliases.has(ref); }

  begin(invocationId: string, ...aliases: string[]): void {
    for (const alias of [invocationId, ...aliases]) {
      const calls = this.aliases.get(alias) ?? new Set<string>();
      calls.add(invocationId);
      this.aliases.set(alias, calls);
    }
  }

  complete(invocationId: string, dataRef: string, metadata?: { symbol?: string; timeframe?: string }): void {
    this.outputs.set(invocationId, dataRef);
    if (metadata) this.metadata.set(dataRef, metadata);
  }

  assertMatches(ref: string, input: any): void {
    const metadata = this.metadata.get(this.resolve(ref));
    if (metadata?.symbol && input.symbol && String(metadata.symbol).toUpperCase() !== String(input.symbol).toUpperCase()) {
      throw new Error('Market-data reference symbol does not match the indicator input');
    }
    if (metadata?.timeframe && input.timeframe && String(metadata.timeframe).toLowerCase() !== String(input.timeframe).toLowerCase()) {
      throw new Error('Market-data reference timeframe does not match the indicator input');
    }
  }

  clear(): void { this.aliases.clear(); this.outputs.clear(); this.metadata.clear(); }

  resolve(ref: string): string {
    const calls = this.aliases.get(ref);
    if (!calls) return ref;
    if (calls.size !== 1) throw new Error('Ambiguous tool reference; pass the exact returned dataRef');
    const key = this.outputs.get(calls.values().next().value!);
    if (!key) throw new Error('Tool invocation has no historical dataRef');
    return key;
  }
}

export function resolveMarketDataRef(ref: string, dataContext?: DataContext, refs?: ToolInvocationRefs): any[] {
  const key = refs?.resolve(ref) ?? ref;
  const bars = key.startsWith('bars:') ? dataContext?.getDataByKey(key) : undefined;
  const valid = Array.isArray(bars) && bars.length > 0 && (refs?.validatedBars.has(bars) ||
    bars.every((bar, index) => bar && ['time', 'open', 'high', 'low', 'close', 'volume'].every(field => Number.isFinite(bar[field])) &&
      bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close) &&
      bar.volume >= 0 && (index === 0 || bar.time >= bars[index - 1].time)));
  if (!valid) {
    throw new Error('Market-data reference unavailable or invalid; fetch historical candles and pass the returned dataRef');
  }
  refs?.validatedBars.add(bars);
  return bars;
}

/**
 * Create a summary from market data bars
 */
function createMarketDataSummary(bars: any[], output: any, toolInput?: any): MarketDataSummary {
  if (!bars || bars.length === 0) {
    return {
      symbol: output?.symbol || toolInput?.symbol || toolInput?.ticker || 'unknown',
      rows: 0,
    };
  }

  const firstBar = bars[0];
  const lastBar = bars[bars.length - 1];
  
  // Normalize bar format (handle different property names)
  const normalizeBar = (bar: any) => ({
    date: new Date(bar.time).toISOString(),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  });

  const first = normalizeBar(firstBar);
  const last = normalizeBar(lastBar);

  // Calculate price change
  const priceChange = last.close - first.close;
  const priceChangePercent = first.close > 0 
    ? ((priceChange / first.close) * 100)
    : 0;

  // Calculate average volume
  const totalVolume = bars.reduce((sum, bar) => {
    return sum + bar.volume;
  }, 0);
  const avgVolume = bars.length > 0 ? Math.round(totalVolume / bars.length) : 0;

  // Find 52-week high/low if enough data
  let high52Week = last.high;
  let low52Week = last.low;
  bars.forEach(bar => {
    const h = bar.high;
    const l = bar.low;
    if (h > high52Week) high52Week = h;
    if (l < low52Week) low52Week = l;
  });

  return {
    symbol: output?.symbol || toolInput?.symbol || toolInput?.ticker || 'unknown',
    timeframe: output?.timeframe || output?.interval || toolInput?.interval || toolInput?.timeframe || undefined,
    source: output?.source || undefined,
    rows: bars.length,
    dateRange: {
      start: first.date,
      end: last.date,
    },
    firstBar: first,
    lastBar: last,
    priceChange: Math.round(priceChange * 100) / 100,
    priceChangePercent: Math.round(priceChangePercent * 100) / 100,
    avgVolume,
    high52Week: Math.round(high52Week * 100) / 100,
    low52Week: Math.round(low52Week * 100) / 100,
  };
}

function createScreenerSummary(output: any) {
  const results = Array.isArray(output)
    ? output
    : Array.isArray(output?.results)
    ? output.results
    : [];

  return {
    count: results.length,
    samples: results.slice(0, 5),
    meta: output?.meta || output?.summary,
  };
}

function createTradeSummary(output: any) {
  const orders = Array.isArray(output)
    ? output
    : Array.isArray(output?.orders)
    ? output.orders
    : output
    ? [output]
    : [];

  const normalizedOrders = orders.map((order: any) => ({
    id: order.id || order.order_id || order.client_order_id,
    symbol: order.symbol || order.asset || order.ticker,
    side: order.side,
    type: order.type,
    status: order.status || order.state,
    filled_qty: order.filled_qty || order.filledQty,
    qty: order.qty || order.quantity,
    price: order.limit_price || order.price,
  }));

  return {
    orders: normalizedOrders,
    count: normalizedOrders.length,
  };
}

/**
 * Process tool output to use dataRef pattern
 * 
 * For market data nodes: stores raw bars in InMemoryStore, returns dataRef + summary
 * For indicator nodes: passes through (already summarized)
 * For other nodes: passes through as-is
 * 
 * @param nodeName - Name of the node that produced the output
 * @param nodeCategory - Category of the node
 * @param output - Raw output from the node executor
 * @param dataContext - DataContext for storing large data
 * @param toolInput - Original input to the tool (used to extract symbol if not in output)
 * @returns ProcessedToolOutput safe for AI consumption
 */
export function processToolOutput(
  nodeName: string,
  nodeCategory: string,
  output: any,
  dataContext?: DataContext,
  toolInput?: any,
  trace?: MarketDataTrace,
): ProcessedToolOutput {
  // If no output, return empty
  if ((output === null || output === undefined) && toolInput?.operation !== 'get_candle') {
    return {
      summary: null,
      cached: false,
    };
  }

  // Check if this is a market data node
  const isMarketDataNode = MARKET_DATA_NODES.some(
    n => nodeName === n || nodeCategory === n
  );

  const isHistorical = toolInput?.operation === 'get_candle' ||
    (isMarketDataNode && (['get_history', 'get_historical_data'].includes(toolInput?.operation) ||
      (!toolInput?.operation && Array.isArray(output?.BarSeries))));
  if (isHistorical) {
    const normalizeStart = performance.now();
    const series = extractHistoricalCandles(output, {
      symbol: toolInput?.symbol || toolInput?.ticker,
      timeframe: toolInput?.timeframe || toolInput?.interval,
    });
    const bars = normalizeCandles(series.bars);
    trace?.('normalize', { durationMs: performance.now() - normalizeStart, rowCount: bars.length });
    if (!bars.length) return { success: false, status: 'no_data', type: 'market_data', rowCount: 0,
      cached: false, summary: { message: 'No historical candles returned' } };
    if (!dataContext) throw new Error('Historical candles require a run-scoped DataContext');
    
    if (bars && bars.length > 0) {
      // Generate unique key for this data - try output first, then toolInput
      const symbol = series.symbol || output?.symbol || toolInput?.symbol || toolInput?.ticker || 'unknown';
      const timeframe = series.timeframe || output?.timeframe || output?.interval || toolInput?.interval || toolInput?.timeframe || 'unknown';
      const key = `bars:${symbol}:${timeframe}:${randomUUID()}`;

      // Store in DataContext
      const storeStart = performance.now();
      const dataRef = dataContext.setData(key, bars, {
        symbol,
        timeframe,
        source: nodeName,
        rowCount: bars.length,
        operation: toolInput?.operation,
      });
      trace?.('store', { durationMs: performance.now() - storeStart, rowCount: bars.length, dataRef: dataRef.ref });

      // Create summary for AI
      const summary = createMarketDataSummary(bars, { symbol, timeframe, source: nodeName }, toolInput);

      return {
        dataRef: dataRef.ref,
        summary,
        rowCount: bars.length,
        cached: false,
        type: 'market_data',
        success: true,
      };
    }
  }

  // Check if this is an indicator node
  const isIndicatorNode = nodeCategory === 'Indicators' || INDICATOR_NODES.some(
    n => nodeName === n || nodeCategory === n
  );

  if (isIndicatorNode) {
    // Indicator nodes already return summarized data
    // Just pass through with proper structure
    return {
      summary: output,
      cached: false,
      type: 'indicator',
    };
  }

  // Screeners: summarize tickers and keep payload small
  const isScreenerNode = SCREENER_NODES.some(
    n => nodeName === n || nodeCategory === n
  );

  if (isScreenerNode) {
    return {
      summary: createScreenerSummary(output),
      cached: false,
      type: 'screener',
    };
  }

  // Trades: return concise order summaries
  const isTradeNode = TRADE_NODES.some(
    n => nodeName === n || nodeCategory === n
  );

  if (isTradeNode) {
    return {
      summary: createTradeSummary(output),
      cached: false,
      type: 'trade',
    };
  }

  // For all other nodes, pass through as-is
  return {
    summary: output,
    cached: false,
    type: 'other',
  };
}

/**
 * Resolve a dataRef to actual data from DataContext
 * Used by indicator nodes to get market data from a previous tool call
 * 
 * @param input - Input that may contain a dataRef
 * @param dataContext - DataContext to retrieve data from
 * @returns The actual data, or the input unchanged if no dataRef
 */
export function resolveDataRef(
  input: any,
  dataContext?: DataContext,
  refs?: ToolInvocationRefs,
): any {
  if (!input) return input;

  // Check if input has a dataRef property
  if (typeof input.dataRef === 'string') {
    refs?.assertMatches(input.dataRef, input);
    const data = resolveMarketDataRef(input.dataRef, dataContext, refs);
    return { ...input, candle_data: data, resolvedData: data };
  }

  // Check common field names that may contain dataRef strings (e.g., candle_data from LLM)
  const dataRefFields = ['candle_data', 'candleData', 'bars', 'data', 'prices'];
  for (const field of dataRefFields) {
    const value = input[field];
    if (typeof value === 'string' && value.trim() && !/^[\s]*[\[{]/.test(value) &&
        (field === 'candle_data' || field === 'candleData' || value.startsWith('bars:') || refs?.hasAlias(value))) {
      refs?.assertMatches(value, input);
      const data = resolveMarketDataRef(value, dataContext, refs);
      return { ...input, [field]: data, resolvedData: data };
    }
    if (value && typeof value === 'object' && typeof value.dataRef === 'string') {
      refs?.assertMatches(value.dataRef, input);
      const data = resolveMarketDataRef(value.dataRef, dataContext, refs);
      return { ...input, [field]: data, resolvedData: data };
    }
  }

  // Check if input itself is a dataRef string
  if (typeof input === 'string' && input.startsWith('bars:')) {
    return resolveMarketDataRef(input, dataContext, refs);
  }

  return input;
}

/**
 * Extract close prices from bars data
 * Used by indicators that need a number array
 * 
 * @param bars - Array of bar objects
 * @param priceField - Which price to extract (default: 'close')
 * @returns Array of numbers
 */
export function extractPrices(
  bars: any[],
  priceField: 'open' | 'high' | 'low' | 'close' = 'close'
): number[] {
  if (!Array.isArray(bars)) return [];
  
  return bars.map(bar => {
    // Handle different property names
    const fieldMap: Record<string, string[]> = {
      open: ['open', 'o'],
      high: ['high', 'h'],
      low: ['low', 'l'],
      close: ['close', 'c'],
    };
    
    const props = fieldMap[priceField] || ['close', 'c'];
    for (const prop of props) {
      if (typeof bar[prop] === 'number' && Number.isFinite(bar[prop])) return bar[prop];
    }
    throw new Error(`Missing or invalid candle ${priceField}`);
  });
}
