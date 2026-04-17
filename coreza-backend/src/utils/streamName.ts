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
  const normalized = eventType.trim();
  switch (normalized) {
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
      return normalized;
  }
}

/**
 * Build native stream name for broker subscription
 */
function buildStreamKey(
  source: string,
  symbol: string,
  eventType: string,
  interval?: string,
): string {
  const sym = symbol.toLowerCase();
  const resolvedEventType = source.startsWith("binance")
    ? normalizeBinanceEventType(eventType)
    : eventType;

  return interval
    ? `${sym}@${resolvedEventType}_${interval}`
    : `${sym}@${resolvedEventType}`;
}

export function buildStreamName(
  source: string,
  symbol: string,
  eventType: string,
  interval?: string,
): string {
  return buildStreamKey(source, symbol, eventType, interval);
}

export function parseStreamName(
  source: string,
  streamName: string,
): StreamIdentifier {
  if (source.startsWith("binance")) {
    const atIndex = streamName.indexOf("@");
    if (atIndex === -1) {
      return { symbol: streamName.toUpperCase(), eventType: "unknown" };
    }

    const sym = streamName.slice(0, atIndex).toUpperCase();
    const typeWithInterval = streamName.slice(atIndex + 1);

    if (typeWithInterval.startsWith("depth")) {
      const interval = typeWithInterval.slice(5);
      return { symbol: sym, eventType: "depth", interval: interval || "20" };
    }

    const underscoreIndex = typeWithInterval.indexOf("_");
    if (underscoreIndex !== -1) {
      const eventType = typeWithInterval.slice(0, underscoreIndex);
      const interval = typeWithInterval.slice(underscoreIndex + 1);
      return { symbol: sym, eventType, interval };
    }

    return { symbol: sym, eventType: typeWithInterval };
  }

  if (source === "alpaca" || source === "alpaca_market") {
    const dotIndex = streamName.indexOf(".");
    if (dotIndex === -1) {
      return { symbol: streamName.toUpperCase(), eventType: "unknown" };
    }

    const eventType = streamName.slice(0, dotIndex);
    const symbol = streamName.slice(dotIndex + 1).toUpperCase();
    return { symbol, eventType };
  }

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

export function buildStreamNames(
  source: string,
  symbols: string[],
  eventTypes: string[],
): string[] {
  const streamNames: string[] = [];

  for (const symbol of symbols) {
    for (const rawEventType of eventTypes) {
      const eventType = source.startsWith("binance")
        ? normalizeBinanceEventType(rawEventType)
        : rawEventType;
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
        const interval = eventType.slice(5);
        streamNames.push(
          buildStreamName(source, symbol, "depth", interval || "20"),
        );
      } else {
        streamNames.push(buildStreamName(source, symbol, eventType));
      }
    }
  }

  return streamNames;
}

export function extractSymbol(source: string, streamName: string): string {
  return parseStreamName(source, streamName).symbol;
}
