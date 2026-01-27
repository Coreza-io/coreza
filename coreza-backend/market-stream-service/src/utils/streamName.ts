/*
 * Copyright (C) 2024 Coreza
 * Stream Name Utilities - Parse native broker stream names
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

/**
 * Parse stream name back to components
 *
 * @param source - Market source (binance_market, alpaca, etc.)
 * @param streamName - Native stream name (btcusdt@kline_1m, bars.AAPL)
 * @returns Parsed stream identifier with symbol, eventType, and optional interval
 */
export function parseStreamName(
  source: string,
  streamName: string
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
 * Extract symbol from a stream name
 *
 * @param source - Market source
 * @param streamName - Native stream name
 * @returns Symbol in uppercase
 */
export function extractSymbol(source: string, streamName: string): string {
  return parseStreamName(source, streamName).symbol;
}
