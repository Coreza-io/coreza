/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { DataContext } from './DataContext';
import { DataRef } from './InMemoryStore';

/**
 * Processed output that's safe for AI agents
 * Contains either a dataRef for large data or the summary directly
 */
export interface ProcessedToolOutput {
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
 * Nodes that return large market data arrays
 */
const MARKET_DATA_NODES = [
  'Market',
  'YahooFinance',
  'Polygon',
  'FinnHub',
  'Alpaca',
  'Binance',
  'Schwab',
  'Dhan',
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
  'Stoch',
  'VWAP',
  'OBV',
  'Ichimoku',
  'VolumeOscillator',
  'SupportResistance',
];

const SCREENER_NODES = [
  'AlpacaScreener',
  'BinanceScreener',
  'YahooFinanceScreener',
  'SchwabScreener',
];

const TRADE_NODES = [
  'AlpacaTrade',
  'BinanceTrade',
  'DhanTrade',
  'SchwabTrade',
];

/**
 * Extract bars array from various output formats
 */
function extractBars(output: any): any[] | null {
  if (!output) return null;
  
  // Direct array
  if (Array.isArray(output)) return output;
  
  // Common property names for bars
  const barsProps = ['bars', 'data', 'candles', 'ohlcv', 'prices', 'quotes'];
  for (const prop of barsProps) {
    if (Array.isArray(output[prop])) {
      return output[prop];
    }
  }
  
  return null;
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
    date: bar.date || bar.timestamp || bar.t || bar.time || '',
    open: bar.open || bar.o || 0,
    high: bar.high || bar.h || 0,
    low: bar.low || bar.l || 0,
    close: bar.close || bar.c || 0,
    volume: bar.volume || bar.v || bar.vol || 0,
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
    return sum + (bar.volume || bar.v || bar.vol || 0);
  }, 0);
  const avgVolume = bars.length > 0 ? Math.round(totalVolume / bars.length) : 0;

  // Find 52-week high/low if enough data
  let high52Week = last.high;
  let low52Week = last.low;
  bars.forEach(bar => {
    const h = bar.high || bar.h || 0;
    const l = bar.low || bar.l || 0;
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
  toolInput?: any
): ProcessedToolOutput {
  // If no output, return empty
  if (output === null || output === undefined) {
    return {
      summary: null,
      cached: false,
    };
  }

  // Check if this is a market data node
  const isMarketDataNode = MARKET_DATA_NODES.some(
    n => nodeName === n || nodeCategory === n
  );

  if (isMarketDataNode && dataContext) {
    const bars = extractBars(output);
    
    if (bars && bars.length > 0) {
      // Generate unique key for this data - try output first, then toolInput
      const symbol = output?.symbol || toolInput?.symbol || toolInput?.ticker || 'unknown';
      const timeframe = output?.timeframe || output?.interval || toolInput?.interval || toolInput?.timeframe || '1d';
      const timestamp = Date.now();
      const key = `bars:${symbol}:${timeframe}:${timestamp}`;

      // Store in DataContext
      const dataRef = dataContext.setData(key, bars, {
        symbol,
        timeframe,
        source: nodeName,
        rowCount: bars.length,
      });

      // Create summary for AI
      const summary = createMarketDataSummary(bars, output, toolInput);

      console.log(`🔗 [ToolProcessor] Stored ${bars.length} bars for ${symbol} as ${key}`);

      return {
        dataRef: dataRef.ref,
        summary,
        rowCount: bars.length,
        cached: false,
        type: 'market_data',
      };
    }
  }

  // Check if this is an indicator node
  const isIndicatorNode = INDICATOR_NODES.some(
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
  dataContext?: DataContext
): any {
  if (!dataContext || !input) return input;

  // Check if input has a dataRef property
  if (typeof input.dataRef === 'string') {
    const data = dataContext.getDataByKey(input.dataRef);
    if (data) {
      console.log(`🔓 [ToolProcessor] Resolved dataRef: ${input.dataRef}`);
      return data;
    }
    console.warn(`⚠️ [ToolProcessor] dataRef not found: ${input.dataRef}`);
  }

  // Check if input itself is a dataRef string
  if (typeof input === 'string' && input.startsWith('bars:')) {
    const data = dataContext.getDataByKey(input);
    if (data) {
      console.log(`🔓 [ToolProcessor] Resolved dataRef string: ${input}`);
      return data;
    }
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
      if (typeof bar[prop] === 'number') return bar[prop];
    }
    return 0;
  });
}
