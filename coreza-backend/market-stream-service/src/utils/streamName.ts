/*
 * Copyright (C) 2024 Coreza
 * Stream Name Utilities - Build and parse native broker stream names
 *
 * Stream names are stored in Redis as native broker format:
 * - Binance: btcusdt@kline_1m, btcusdt@trade, btcusdt@depth20
 * - Alpaca: bars.AAPL, trades.AAPL, quotes.AAPL
 */

export interface StreamIdentifier {
  symbol: string;
  eventType: string;
  interval?: string;
}


function normalizeBinanceEventType(eventType: string): string {
  switch (eventType.trim()) {
    case "liquidation":
      return "forceOrder";
    case "continuousKline":
      return "continuous_kline";
    case "markPrice":
      return "markPrice";
    case "indexPrice":
      return "indexPrice";
    case "compositeIndex":
      return "compositeIndex";
    default:
      return eventType.trim();
  }
}


/**
 * Build native stream name for broker subscription
 *
 * @param source - Market source (binance_market, alpaca, etc.)
 * @param symbol - Trading symbol (BTCUSDT, AAPL)
 * @param eventType - Event type (kline, trade, bars, etc.)
 * @param interval - Optional interval (1m, 5m, 20 for depth)
 * @returns Native stream name (btcusdt@kline_1m, bars.AAPL)
 */
export function buildStreamName(
  source: string,
  symbol: string,
  eventType: string,
  interval?: string,
): string {
  const sym = symbol.toLowerCase();

  // Alpaca trading: fixed stream name (trade_updates covers all symbols for the account)
  if (source === "alpaca_trading") {
    return "trade_updates";
  }

  // Binance trading: fixed stream name (User Data Stream covers all account events)
  if (source === "binance_trading") {
    return "trade_updates";
  }

  const resolvedEventType = source.startsWith("binance")
    ? normalizeBinanceEventType(eventType)
    : eventType;

  return interval
    ? `${sym}@${resolvedEventType}_${interval}`
    : `${sym}@${resolvedEventType}`;
}

/**
 * Parse stream name back to components
 *
 * @param source - Market source (binance_market, alpaca, etc.)
 * @param streamName - Native stream name (btcusdt@kline_1m, bars.AAPL)
 * @returns Parsed stream identifier with symbol, eventType, and optional interval
 */
export function parseStreamName(
  source: string,
  streamName: string,
): StreamIdentifier {
  // Binance format: btcusdt@kline_1m, btcusdt@trade, btcusdt@depth20
  if (source.startsWith("binance")) {
    const atIndex = streamName.indexOf("@");
    if (atIndex === -1) {
      return { symbol: streamName.toUpperCase(), eventType: "unknown" };
    }

    const sym = streamName.slice(0, atIndex).toUpperCase();
    const typeWithInterval = streamName.slice(atIndex + 1);

    // Handle depth: depth20 -> eventType: depth, interval: 20
    if (typeWithInterval.startsWith("depth")) {
      const interval = typeWithInterval.slice(5); // Remove "depth"
      return { symbol: sym, eventType: "depth", interval: interval || "20" };
    }

    // Handle kline: kline_1m -> eventType: kline, interval: 1m
    const underscoreIndex = typeWithInterval.indexOf("_");
    if (underscoreIndex !== -1) {
      const eventType = typeWithInterval.slice(0, underscoreIndex);
      const interval = typeWithInterval.slice(underscoreIndex + 1);
      return { symbol: sym, eventType, interval };
    }

    // No interval: trade, aggTrade, ticker, bookTicker
    return { symbol: sym, eventType: typeWithInterval };
  }

  // Alpaca trading: fixed stream name
  if (source === "alpaca_trading") {
    return { symbol: "*", eventType: "order_update" };
  }

  // Binance trading: fixed stream name
  if (source === "binance_trading") {
    return { symbol: "*", eventType: "order_update" };
  }

  // Alpaca format: bars.AAPL, trades.AAPL, quotes.AAPL
  if (source === "alpaca" || source === "alpaca_market") {
    const dotIndex = streamName.indexOf(".");
    if (dotIndex === -1) {
      return { symbol: streamName.toUpperCase(), eventType: "unknown" };
    }

    const eventType = streamName.slice(0, dotIndex);
    const symbol = streamName.slice(dotIndex + 1).toUpperCase();
    return { symbol, eventType };
  }

  // Default parsing: symbol@eventType_interval
  const atIndex = streamName.indexOf("@");
  if (atIndex === -1) {
    return { symbol: streamName.toUpperCase(), eventType: "unknown" };
  }

  const sym = streamName.slice(0, atIndex).toUpperCase();
  const rest = streamName.slice(atIndex + 1);
  const underscoreIndex = rest.indexOf("_");

  if (underscoreIndex !== -1) {
    return {
      symbol: sym,
      eventType: rest.slice(0, underscoreIndex),
      interval: rest.slice(underscoreIndex + 1),
    };
  }

  return { symbol: sym, eventType: rest };
}

/**
 * Build multiple stream names from arrays of symbols and event types
 *
 * @param source - Market source
 * @param symbols - Array of symbols
 * @param eventTypes - Array of event types (may include interval suffix like kline_1m)
 * @returns Array of native stream names
 */
export function buildStreamNames(
  source: string,
  symbols: string[],
  eventTypes: string[],
  interval: string,
): string[] {
  const streamNames: string[] = [];

  for (const symbol of symbols) {
    for (const rawEventType of eventTypes) {
      const eventType = source.startsWith("binance")
        ? normalizeBinanceEventType(rawEventType)
        : rawEventType;
      // Parse event types that may already include interval (e.g., kline_1m)
      const underscoreIndex = eventType.indexOf("_");
      if (
        underscoreIndex !== -1 &&
        source.startsWith("binance") &&
        eventType !== "continuous_kline"
      ) {
        const type = eventType.slice(0, underscoreIndex);
        const interval = eventType.slice(underscoreIndex + 1);
        streamNames.push(buildStreamName(source, symbol, type, interval));
      } else if (
        eventType.startsWith("depth") &&
        source.startsWith("binance")
      ) {
        // Handle depth20, depth10, etc.
        const interval = eventType.slice(5);
        streamNames.push(
          buildStreamName(source, symbol, "depth", interval || "20"),
        );
      } else {
        streamNames.push(buildStreamName(source, symbol, eventType, interval));
      }
    }
  }

  return streamNames;
}

/**
 * Extract symbol from a stream name
 *
 * @param source - Market source
 * @param streamName - Native stream name
 * @returns Symbol in uppercase
 */
export function extractSymbol(source: string, streamName: string): string {
  return parseStreamName(source, streamName).symbol;
}
