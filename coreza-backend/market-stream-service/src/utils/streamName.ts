import { getBrokerStreamConfig } from "../config/brokerStreamConfig";

export interface StreamIdentifier {
  symbol: string;
  streamType: string;
  interval?: string;
  contractType?: string;
  exchange?: string;
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
  "order_update",
  "order_alert",
  "account_activity",
]);

export function tradingRoutingKey(source: string, eventType: string): string {
  const cfg = getBrokerStreamConfig(source);
  if (!cfg.tradingRoutingKey)
    throw new Error(`Unsupported trading source for routing key: ${source}`);
  return cfg.tradingRoutingKey(eventType);
}

export function buildStreamName(
  source: string,
  symbol: string,
  streamType: string,
  interval?: string,
  contractType?: string,
  exchange?: string,
): string {
  if (source.endsWith("_trading")) return tradingRoutingKey(source, streamType);
  const cfg = getBrokerStreamConfig(source);
  const normalizedStreamType = cfg.normalizeStreamType
    ? cfg.normalizeStreamType(streamType)
    : streamType;

  if (normalizedStreamType === "continuous_kline") {
    if (!interval)
      throw new Error("interval is required for continuousKline stream names");
    return `${symbol}_${contractType || "perpetual"}@${normalizedStreamType}_${interval}`;
  }
  const typePart = interval
    ? `${normalizedStreamType}_${interval}`
    : normalizedStreamType;
  const exchangePart = exchange
    ? `${cfg.separator}${exchange.toLowerCase()}`
    : "";
  return cfg.symbolFirst
    ? `${symbol}${exchangePart}${cfg.separator}${typePart}`
    : `${typePart}${cfg.separator}${symbol}${exchangePart}`;
}

export function parseStreamName(
  source: string,
  streamName: string,
): StreamIdentifier {
  if (NATIVE_TRADING_STREAM_NAMES.has(streamName))
    return { symbol: "*", streamType: streamName };
  const cfg = getBrokerStreamConfig(source);

  // Exchange-qualified names: symbol@exchange@type[_interval] (e.g. dhan)
  if (cfg.symbolFirst && !streamName.includes("continuous")) {
    const parts = streamName.split(cfg.separator);
    if (parts.length === 3) {
      const [rawSymbol, exchange, typeWithInterval] = parts;
      return {
        ...parseTypeWithInterval(rawSymbol, typeWithInterval),
        exchange,
      };
    }
  }

  const idx = streamName.indexOf(cfg.separator);
  if (idx === -1)
    return { symbol: streamName.toUpperCase(), streamType: "unknown" };
  const left = streamName.slice(0, idx);
  const right = streamName.slice(idx + cfg.separator.length);
  const rawSymbol = cfg.symbolFirst ? left : right;
  const typeWithInterval = cfg.symbolFirst ? right : left;
  return parseTypeWithInterval(rawSymbol, typeWithInterval);
}

function parseTypeWithInterval(
  rawSymbol: string,
  typeWithInterval: string,
): StreamIdentifier {
  if (typeWithInterval.startsWith("depth")) {
    const d = typeWithInterval.slice(5);
    return {
      symbol: rawSymbol.toUpperCase(),
      streamType: "depth",
      interval: d || "20",
    };
  }
  const underscoreIndex = typeWithInterval.indexOf("_");
  if (underscoreIndex !== -1) {
    const streamType = typeWithInterval.slice(0, underscoreIndex);
    const interval = typeWithInterval.slice(underscoreIndex + 1);
    if (streamType === "continuousKline" || streamType === "continuous_kline") {
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
  return { symbol: rawSymbol.toUpperCase(), streamType: typeWithInterval };
}

export function buildStreamNames(
  source: string,
  symbols: string[],
  streamTypes: string[],
  interval: string,
  contractType?: string,
): string[] {
  const streamNames: string[] = [];
  for (const symbol of symbols)
    for (const streamType of streamTypes)
      streamNames.push(
        buildStreamName(
          source,
          symbol.toLocaleLowerCase(),
          streamType,
          interval,
          contractType,
        ),
      );
  return streamNames;
}

export function extractSymbol(source: string, streamName: string): string {
  return parseStreamName(source, streamName).symbol;
}
