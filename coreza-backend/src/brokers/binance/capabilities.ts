import { BrokerCapabilities, StreamIdentifier } from "../capabilities";
import { extractBinanceOrderOwnerIds } from "./orderOwnerExtract";

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

function parseBinanceStreamName(streamName: string): StreamIdentifier {
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
    const eventType = normalizeBinanceEventType(
      typeWithInterval.slice(0, underscoreIndex),
    );
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
  const normalizedContractType = contractType || "perpetual";
  const sym =
    resolvedEventType === "continuous_kline"
      ? `${symbol.toLowerCase()}_${normalizedContractType}`
      : symbol.toLowerCase();

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

  assetTypes: ["spot", "futures"],

  toolDescriptions: {
    data: "Get crypto market data from Binance including kline candles.",
    trade: "Place or manage crypto orders on Binance.",
    screener:
      "Filter Binance instruments by volume, price change, and symbol patterns.",
  },
};
