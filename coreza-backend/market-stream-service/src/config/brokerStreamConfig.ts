import type { MarketSource } from "../types/marketEvent";

export interface BrokerStreamConfig {
  separator: string;
  symbolFirst: boolean;
  tradingStreams?: { futures: string[]; spot: string[] };
  tradingRoutingKey?: (eventType: string) => string;
  companionSources?: string[];
  emitsUnclosedBars?: boolean;
  normalizeOrderSymbol?: (symbol: string) => string;
}

const DEFAULT_STREAM_CONFIG: BrokerStreamConfig = {
  separator: "@",
  symbolFirst: true,
  companionSources: [],
  emitsUnclosedBars: false,
};

const BROKER_STREAM_CONFIG: Record<string, BrokerStreamConfig> = {
  alpaca: {
    separator: ".",
    symbolFirst: false,
    companionSources: ["alpaca_trading", "alpaca_news"],
    normalizeOrderSymbol: (symbol: string) => symbol.replace("/", ""),
  },
  binance: {
    separator: "@",
    symbolFirst: true,
    companionSources: ["binance_trading"],
    emitsUnclosedBars: true,
  },
  alpaca_trading: {
    separator: "@",
    symbolFirst: true,
    tradingRoutingKey: () => "trade_updates",
    tradingStreams: { futures: ["trade_updates"], spot: ["trade_updates"] },
  },
  binance_trading: {
    separator: "@",
    symbolFirst: true,
    tradingRoutingKey: (eventType: string) => eventType,
    tradingStreams: {
      spot: ["executionReport", "outboundAccountPosition", "balanceUpdate", "listenKeyExpired"],
      futures: ["ORDER_TRADE_UPDATE", "ALGO_UPDATE", "ACCOUNT_UPDATE", "ACCOUNT_CONFIG_UPDATE", "MARGIN_CALL", "listenKeyExpired"],
    },
  },
};

export function getBrokerStreamConfig(source: string): BrokerStreamConfig {
  const base = String(source || "").split("_")[0];
  return BROKER_STREAM_CONFIG[source] || BROKER_STREAM_CONFIG[base] || DEFAULT_STREAM_CONFIG;
}

export function computeTradingNativeStreamsFromConfig(source: string, marketType?: string): string[] {
  const cfg = getBrokerStreamConfig(source);
  if (!cfg.tradingStreams) return [];
  return String(marketType).toLowerCase() === "spot" ? cfg.tradingStreams.spot : cfg.tradingStreams.futures;
}

export function getCompanionSources(source: MarketSource | string): string[] {
  return [...(getBrokerStreamConfig(source).companionSources || [])];
}
