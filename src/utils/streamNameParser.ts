/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { getBrokerConfig, type BrokerUIConfig } from "./brokerRegistry";

export interface ParsedStream {
  symbol: string;
  eventType: string;
  interval?: string;
  exchange?: string;
  contractType?: string;
}

export const KNOWN_TRADING_STREAMS = new Set([
  "trade_updates",
  "order_update",
  "account_activity",
  "order_alert",
  "order_trade_update",
  "algo_update",
  "account_update",
  "account_config_update",
  "margin_call",
  "listenkeyexpired",
  "executionreport",
  "outboundaccountposition",
  "balanceupdate",
]);

/**
 * Parse native stream name to components.
 * Uses broker registry streamFormat instead of hardcoded source checks.
 * 
 * 'at' format:  symbol@type_interval  (e.g. btcusdt@kline_1m)
 * 'dot' format: type.SYMBOL           (e.g. bars.AAPL)
 */
export function parseStreamName(
  source: string,
  streamName: string,
): ParsedStream {
  // Account-wide trading streams (no symbol)
  if (KNOWN_TRADING_STREAMS.has(streamName.toLowerCase())) {
    return { symbol: "", eventType: "order_update" };
  }

  const config = getBrokerConfig(source);
  const format = config?.streamFormat ?? 'generic';

  if (format === 'at') {
    return parseAtFormat(streamName, false, config?.parseStreamSymbol);
  }

  if (format === 'dot') {
    // Alpaca subscriptions also store symbol@event names.
    if (streamName.includes('@')) return parseAtFormat(streamName, false, config?.parseStreamSymbol);
    return parseDotFormat(streamName);
  }

  // Generic fallback: try both formats
  if (streamName.includes('@')) return parseAtFormat(streamName, false, config?.parseStreamSymbol);
  if (streamName.includes('.')) return parseDotFormat(streamName);

  return { symbol: streamName.toUpperCase(), eventType: "unknown" };
}

/** Parse symbol@type_interval format */
function parseAtFormat(
  streamName: string,
  preserveNativeType = false,
  parseSymbol?: BrokerUIConfig["parseStreamSymbol"],
): ParsedStream {
  const atIndex = streamName.indexOf("@");
  if (atIndex === -1) {
    return { symbol: streamName.toUpperCase(), eventType: "unknown" };
  }
  const parts = streamName.split("@");
  const exchange = parts.length === 3 ? parts[1].toUpperCase() : undefined;
  const typeWithInterval = parts[parts.length - 1];
  const rawSymbol = parts[0].toUpperCase();
  if (parts.length !== 2 && parts.length !== 3) {
    return { symbol: rawSymbol, eventType: "unknown" };
  }

  if (!preserveNativeType && typeWithInterval.startsWith("depth")) {
    return { symbol: rawSymbol, eventType: "depth", interval: typeWithInterval.slice(5) || "20", exchange };
  }
  const timedStream = typeWithInterval.match(/^(.+)_(\d+[a-zA-Z]+)$/);
  const eventType = timedStream?.[1] ?? typeWithInterval;
  const decoded = parseSymbol?.(parts[0], eventType) ?? { symbol: parts[0] };
  return {
    symbol: decoded.symbol.toUpperCase(),
    eventType,
    interval: timedStream?.[2],
    exchange,
    contractType: decoded.contractType,
  };
}

/** Parse subscription actions without converting native trading/depth event names to display labels. */
export function parseSubscriptionStreamName(source: string, streamName: string): ParsedStream {
  if (KNOWN_TRADING_STREAMS.has(streamName.toLowerCase())) {
    return { symbol: "*", eventType: streamName };
  }
  const config = getBrokerConfig(source);
  const format = config?.streamFormat ?? "generic";
  const parsed = streamName.includes("@")
    ? parseAtFormat(streamName, true, config?.parseStreamSymbol)
    : (format === "dot" || format === "generic") && streamName.includes(".")
      ? parseDotFormat(streamName) : undefined;
  if (!parsed?.symbol || !parsed.eventType || parsed.eventType === "unknown" || parsed.exchange === "") {
    throw new Error(`Invalid subscription stream: ${streamName}`);
  }
  return parsed;
}

/** Parse type.SYMBOL format */
function parseDotFormat(streamName: string): ParsedStream {
  const dotIndex = streamName.indexOf(".");
  if (dotIndex === -1) {
    return { symbol: streamName.toUpperCase(), eventType: "unknown" };
  }
  return {
    symbol: streamName.slice(dotIndex + 1).toUpperCase(),
    eventType: streamName.slice(0, dotIndex),
  };
}

/**
 * Get human-readable event type label
 */
export function getEventTypeLabel(eventType: string): string {
  const labels: Record<string, string> = {
    kline: "Candlestick (Kline)",
    trade: "Trade",
    aggTrade: "Aggregated Trade",
    depth: "Order Book Depth",
    ticker: "24h Ticker",
    bookTicker: "Best Bid/Ask",
    bar: "Bar",
    bars: "Bars (OHLCV)",
    trades: "Trades",
    quotes: "Quotes",
    order_update: "Order Updates (Fills)",
  };
  return labels[eventType] || eventType;
}

/**
 * Extract environment from source
 */
export function getEnvironment(source: string, override?: string): string {
  if (override) return override;
  if (source.includes("testnet")) return "Testnet";
  if (source.includes("paper")) return "Paper Trading";
  return "Live";
}
