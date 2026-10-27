import { BrokerCapabilities, StreamIdentifier } from "../capabilities";
import { extractBinanceOrderOwnerIds } from "./orderOwnerExtract";

function normalizeBinanceEventType(eventType: string): string {
  const normalized = eventType.trim().replace(/^continuous_kline(?=_|$)/, "continuousKline");
  switch (normalized) {
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
      return normalized;
  }
}

function parseBinanceStreamName(streamName: string): StreamIdentifier {
  const atIndex = streamName.indexOf("@");
  if (atIndex === -1) {
    return { symbol: streamName.toUpperCase(), eventType: "unknown" };
  }

  const rawSymbol = streamName.slice(0, atIndex);
  const typeWithInterval = streamName.slice(atIndex + 1);

  const continuous = /^(?:continuousKline|continuous_kline)(?:_(.*))?$/.exec(typeWithInterval);
  if (continuous) {
    const contract = /^(.*)_(perpetual|current_quarter|next_quarter)$/i.exec(rawSymbol);
    return {
      symbol: (contract?.[1] ?? rawSymbol).toUpperCase(),
      eventType: "continuousKline",
      interval: continuous[1],
      contractType: contract?.[2].toLowerCase() ?? "perpetual",
    };
  }

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
    const eventType = normalizeBinanceEventType(
      typeWithInterval.slice(0, underscoreIndex),
    );
    const interval = typeWithInterval.slice(underscoreIndex + 1);

    return { symbol: rawSymbol.toUpperCase(), eventType, interval };
  }

  return {
    symbol: rawSymbol.toUpperCase(),
    eventType: normalizeBinanceEventType(typeWithInterval),
  };
}

function buildBinanceStreamName(
  symbol: string,
  eventType: string,
  interval?: string,
  contractType?: string,
): string {
  const resolvedEventType = normalizeBinanceEventType(eventType);
  const continuous = /^continuousKline(?:_(.*))?$/.exec(resolvedEventType);
  if (continuous) {
    const resolvedInterval = (continuous[1] ?? interval)?.trim();
    if (!resolvedInterval) throw new Error("interval is required for continuousKline stream names");
    const contract = contractType?.trim().toLowerCase() || "perpetual";
    if (!["perpetual", "current_quarter", "next_quarter"].includes(contract))
      throw new Error(`Unsupported Binance continuous contract: ${contract}`);
    return `${symbol.toLowerCase()}_${contract}@continuousKline_${resolvedInterval}`;
  }
  const sym = symbol.toLowerCase();

  return interval
    ? `${sym}@${resolvedEventType}_${interval}`
    : `${sym}@${resolvedEventType}`;
}

export const binanceCapabilities: BrokerCapabilities = {
  id: "binance",
  displayName: "Binance",

  nodeNames: {
    data: "Binance",
    trade: "BinanceTrade",
    screener: "BinanceScreener",
    subscribe: "BinanceSubscribe",
    streamData: "BinanceStreamData",
  },

  streaming: {
    sourceId: "binance_stream",
    tradingSourceId: "binance_trading",
    tradingStreams: [
      "ORDER_TRADE_UPDATE",
      "ALGO_UPDATE",
      "ACCOUNT_UPDATE",
      "ACCOUNT_CONFIG_UPDATE",
      "MARGIN_CALL",
      "listenKeyExpired",
    ],
    spotTradingStreams: [
      "executionReport",
      "outboundAccountPosition",
      "balanceUpdate",
      "listenKeyExpired",
    ],
  },

  streamParser: {
    separator: "@",
    symbolFirst: true,
    normalizeEventType: normalizeBinanceEventType,
    customParser: parseBinanceStreamName,
    customBuilder: buildBinanceStreamName,
  },

  orderOwnerExtract: extractBinanceOrderOwnerIds,

  tradingRoutingKey: (eventType: string) => eventType,

  credentialValidation: {
    requiredFields: [
      { key: "api_key", label: "Binance API key", minLength: 10 },
      { key: "secret_key", label: "Binance secret key", minLength: 10 },
    ],
  },

  supportsAlgoOrders: true,

  assetTypes: ["spot", "futures"],

  toolDescriptions: {
    data: "Get crypto market data from Binance including kline candles.",
    trade: "Place or manage crypto orders on Binance.",
    screener:
      "Filter Binance instruments by volume, price change, and symbol patterns.",
  },
};
