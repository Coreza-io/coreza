/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

export interface StreamIdentifier {
  symbol: string;
  eventType: string;
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

function normalizeBinanceEventType(eventType: string): string {
  const normalized = eventType.trim();
  switch (normalized) {
    case "liquidation":
      return "forceOrder";
    case "continuous_kline":
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
  contractType?: string,
): string {
  if (source === "alpaca_trading" || source === "binance_trading") {
    return tradingRoutingKey(source, eventType);
  }

  const resolvedEventType = source.startsWith("binance")
    ? normalizeBinanceEventType(eventType)
    : eventType;
  const normalizedContractType = contractType || "perpetual";
  const sym =
    source.startsWith("binance") && resolvedEventType === "continuous_kline"
      ? `${symbol.toLowerCase()}_${normalizedContractType}`
      : symbol.toLowerCase();

  return interval
    ? `${sym}@${resolvedEventType}_${interval}`
    : `${sym}@${resolvedEventType}`;
}

export function buildStreamName(
  source: string,
  symbol: string,
  eventType: string,
  interval?: string,
  contractType?: string,
): string {
  return buildStreamKey(source, symbol, eventType, interval, contractType);
}

export function parseStreamName(
  source: string,
  streamName: string,
): StreamIdentifier {
  if (NATIVE_TRADING_STREAM_NAMES.has(streamName)) {
    return { symbol: "*", eventType: streamName };
  }

  if (source.startsWith("binance")) {
    const atIndex = streamName.indexOf("@");
    if (atIndex === -1) {
      return { symbol: streamName.toUpperCase(), eventType: "unknown" };
    }

    const rawSymbol = streamName.slice(0, atIndex);
    const typeWithInterval = streamName.slice(atIndex + 1);

    if (typeWithInterval.startsWith("depth")) {
      const interval = typeWithInterval.slice(5);
      return {
        symbol: rawSymbol.toUpperCase(),
        eventType: "depth",
        interval: interval || "20",
      };
    }

    const underscoreIndex = typeWithInterval.indexOf("_");
    if (underscoreIndex !== -1) {
      const eventType = typeWithInterval.slice(0, underscoreIndex);
      const interval = typeWithInterval.slice(underscoreIndex + 1);
      if (eventType === "continuous_kline") {
        const [symbolPart, ...contractParts] = rawSymbol.split("_");
        return {
          symbol: symbolPart.toUpperCase(),
          eventType: "continuousKline",
          interval,
          contractType: contractParts.length
            ? contractParts.join("_")
            : "perpetual",
        };
      }
      return { symbol: rawSymbol.toUpperCase(), eventType, interval };
    }

    return { symbol: rawSymbol.toUpperCase(), eventType: typeWithInterval };
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
  interval?: string,
  contractType?: string,
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
        streamNames.push(
          buildStreamName(source, symbol, type, interval, contractType),
        );
      } else if (
        eventType.startsWith("depth") &&
        source.startsWith("binance")
      ) {
        const interval = eventType.slice(5);
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
          buildStreamName(source, symbol, eventType, interval, contractType),
        );
      }
    }
  }

  return streamNames;
}

export function extractSymbol(source: string, streamName: string): string {
  return parseStreamName(source, streamName).symbol;
}
