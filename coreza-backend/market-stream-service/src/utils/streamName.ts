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

function normalizeBinancestreamType(streamType: string): string {
  switch (streamType.trim()) {
    case "liquidation":
      return "forceOrder";
    case "continuous_kline":
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
  // Alpaca trading: fixed stream name (order_updates covers all symbols for the account)
  if (source === "alpaca_trading") {
    return "order_updates";
  }

  // Binance trading: fixed stream name (User Data Stream covers all account events)
  if (source === "binance_trading") {
    return "order_updates";
  }

  const resolvedstreamType = source.startsWith("binance")
    ? normalizeBinancestreamType(streamType)
    : streamType;
  const normalizedContractType = contractType || "perpetual";
  const sym =
    source.startsWith("binance") && resolvedstreamType === "continuousKline"
      ? `${symbol.toLowerCase()}_${normalizedContractType}`
      : symbol.toLowerCase();

  return interval
    ? `${sym}@${resolvedstreamType}_${interval}`
    : `${sym}@${resolvedstreamType}`;
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
      if (streamType === "continuous_kline") {
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

  // Alpaca trading: fixed stream name
  if (source === "alpaca_trading") {
    return { symbol: "*", streamType: "order_update" };
  }

  // Binance trading: fixed stream name
  if (source === "binance_trading") {
    return { symbol: "*", streamType: "order_update" };
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
      // const streamType = source.startsWith("binance")
      //   ? normalizeBinancestreamType(rawstreamType)
      //   : rawstreamType;
      // Parse event types that may already include interval (e.g., kline_1m)
      const underscoreIndex = streamType.indexOf("_");
      if (
        underscoreIndex !== -1 &&
        source.startsWith("binance") &&
        streamType !== "continuousKline"
      ) {
        const type = streamType.slice(0, underscoreIndex);
        const interval = streamType.slice(underscoreIndex + 1);
        streamNames.push(
          buildStreamName(source, symbol, type, interval, contractType),
        );
      } else if (
        streamType.startsWith("depth") &&
        source.startsWith("binance")
      ) {
        // Handle depth20, depth10, etc.
        const interval = streamType.slice(5);
        streamNames.push(
          buildStreamName(
            source,
            symbol,
            "depth",
            interval || "20",
            contractType,
          ),
        );
      } else {
        streamNames.push(
          buildStreamName(source, symbol, streamType, interval, contractType),
        );
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
