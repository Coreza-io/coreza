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
  streamType: string;
  interval?: string;
  contractType?: string;
}

export const NATIVE_TRADING_STREAM_NAMES = new Set([
  "trade_updates",
  "ORDER_TRADE_UPDATE",
  "ALGO_UPDATE",
  "ACCOUNT_UPDATE",
  "ACCOUNT_CONFIG_UPDATE",
  "MARGIN_CALL",
  "listenKeyExpired",
  "executionReport",
  "outboundAccountPosition",
  "balanceUpdate",
  "order_update", // backwards-compatible alias during rollout
]);

export function tradingRoutingKey(source: string, eventType: string): string {
  if (source === "alpaca_trading") {
    return "trade_updates";
  }

  if (source === "binance_trading") {
    return eventType;
  }

  throw new Error(`Unsupported trading source for routing key: ${source}`);
}

function normalizeBinancestreamType(streamType: string): string {
  switch (streamType.trim()) {
    case "liquidation":
      return "forceOrder";
    case "continuousKline":
      return "continuousKline";
    case "markPrice":
      return "markPrice";
    case "indexPrice":
      return "indexPrice";
    case "compositeIndex":
      return "compositeIndex";
    default:
      return streamType.trim();
  }
}

/**
 * Build native stream name for broker subscription
 *
 * @param source - Market source (binance_market, alpaca, etc.)
 * @param symbol - Trading symbol (BTCUSDT, AAPL)
 * @param streamType - Event type (kline, trade, bars, etc.)
 * @param interval - Optional interval (1m, 5m, 20 for depth)
 * @returns Native stream name (btcusdt@kline_1m, bars.AAPL)
 */
export function buildStreamName(
  source: string,
  symbol: string,
  streamType: string,
  interval?: string,
  contractType?: string,
): string {
  // Trading user-data streams: fixed stream name
  if (source === "alpaca_trading" || source === "binance_trading") {
    return tradingRoutingKey(source, streamType);
  }

  // Binance futures continuous kline:
  // <pair>_<contractType>@continuousKline_<interval>
  if (streamType === "continuousKline") {
    if (!interval) {
      throw new Error("interval is required for continuousKline stream names");
    }

    return `${symbol}_${contractType || "perpetual"}@${streamType}_${interval}`;
  }

  // Normal kline-style streams that require interval:
  // <symbol>@kline_<interval>
  if (interval) {
    return `${symbol}@${streamType}_${interval}`;
  }

  // Non-interval streams like aggTrade:
  // <symbol>@aggTrade
  return `${symbol}@${streamType}`;
}

/**
 * Parse stream name back to components
 *
 * @param source - Market source (binance_market, alpaca, etc.)
 * @param streamName - Native stream name (btcusdt@kline_1m, bars.AAPL)
 * @returns Parsed stream identifier with symbol, streamType, and optional interval
 */
export function parseStreamName(
  source: string,
  streamName: string,
): StreamIdentifier {
  if (NATIVE_TRADING_STREAM_NAMES.has(streamName)) {
    return { symbol: "*", streamType: streamName };
  }

  // Binance format: btcusdt@kline_1m, btcusdt@trade, btcusdt@depth20
  if (source.startsWith("binance")) {
    const atIndex = streamName.indexOf("@");
    if (atIndex === -1) {
      return { symbol: streamName.toUpperCase(), streamType: "unknown" };
    }

    const rawSymbol = streamName.slice(0, atIndex);
    const typeWithInterval = streamName.slice(atIndex + 1);

    // Handle depth: depth20 -> streamType: depth, interval: 20
    if (typeWithInterval.startsWith("depth")) {
      const interval = typeWithInterval.slice(5); // Remove "depth"
      return {
        symbol: rawSymbol.toUpperCase(),
        streamType: "depth",
        interval: interval || "20",
      };
    }

    // Handle kline: kline_1m -> streamType: kline, interval: 1m
    const underscoreIndex = typeWithInterval.indexOf("_");
    if (underscoreIndex !== -1) {
      const streamType = typeWithInterval.slice(0, underscoreIndex);
      const interval = typeWithInterval.slice(underscoreIndex + 1);
      if (streamType === "continuousKline") {
        const [symbolPart, ...contractParts] = rawSymbol.split("_");
        return {
          symbol: symbolPart.toUpperCase(),
          streamType: "continuousKline",
          interval,
          contractType: contractParts.length
            ? contractParts.join("_")
            : "perpetual",
        };
      }
      return { symbol: rawSymbol.toUpperCase(), streamType, interval };
    }

    // No interval: trade, aggTrade, ticker, bookTicker
    return { symbol: rawSymbol.toUpperCase(), streamType: typeWithInterval };
  }

  // Alpaca format: bars.AAPL, trades.AAPL, quotes.AAPL
  if (source === "alpaca" || source === "alpaca_market") {
    const dotIndex = streamName.indexOf(".");
    if (dotIndex === -1) {
      return { symbol: streamName.toUpperCase(), streamType: "unknown" };
    }

    const streamType = streamName.slice(0, dotIndex);
    const symbol = streamName.slice(dotIndex + 1).toUpperCase();
    return { symbol, streamType };
  }

  // Default parsing: symbol@streamType_interval
  const atIndex = streamName.indexOf("@");
  if (atIndex === -1) {
    return { symbol: streamName.toUpperCase(), streamType: "unknown" };
  }

  const sym = streamName.slice(0, atIndex).toUpperCase();
  const rest = streamName.slice(atIndex + 1);
  const underscoreIndex = rest.indexOf("_");

  if (underscoreIndex !== -1) {
    return {
      symbol: sym,
      streamType: rest.slice(0, underscoreIndex),
      interval: rest.slice(underscoreIndex + 1),
    };
  }

  return { symbol: sym, streamType: rest };
}

/**
 * Build multiple stream names from arrays of symbols and event types
 *
 * @param source - Market source
 * @param symbols - Array of symbols
 * @param streamTypes - Array of event types (may include interval suffix like kline_1m)
 * @returns Array of native stream names
 */
export function buildStreamNames(
  source: string,
  symbols: string[],
  streamTypes: string[],
  interval: string,
  contractType?: string,
): string[] {
  const streamNames: string[] = [];

  for (const symbol of symbols) {
    for (const streamType of streamTypes) {
      streamNames.push(
        buildStreamName(
          source,
          symbol.toLocaleLowerCase(),
          streamType,
          interval,
          contractType,
        ),
      );
      // }
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
