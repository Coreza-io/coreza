import type { MarketSource } from "../types/marketEvent";

export interface BrokerStreamConfig {
  separator: string;
  symbolFirst: boolean;
  buildStreamNames?: (
    symbols: string[],
    streamTypes: string[],
    exchange?: string,
  ) => string[];
  toRoutingStreamName?: (streamName: string) => string;
  redactAuthMessage?: (msg: unknown) => unknown;
  tradingStreams?: Partial<Record<"spot" | "futures" | "account", string[]>>;
  tradingRoutingKey?: (eventType: string) => string;
  companionSources?: string[];
  emitsUnclosedBars?: boolean;
  normalizeOrderSymbol?: (symbol: string) => string;
  resolveSourceForSymbol?: (symbol: string, defaultSource: string) => string;
  normalizeStreamType?: (streamType: string) => string;
  unifiedSocket?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  const cloned: unknown = JSON.parse(JSON.stringify(value));
  return isRecord(cloned) ? cloned : {};
}

function buildMetadataStreamNames(
  symbols: string[],
  streamTypes: string[],
  exchange?: string,
): string[] {
  const exchangeSegment = String(exchange || "NSE_EQ").trim() || "NSE_EQ";
  const modes = streamTypes.length > 0 ? streamTypes : ["ticker"];
  const streamNames: string[] = [];

  for (const symbol of symbols) {
    const securityId = String(symbol).trim();
    if (!securityId) continue;

    for (const mode of modes) {
      streamNames.push(`${securityId}@${exchangeSegment}@${mode}`);
    }
  }

  return streamNames;
}

function toSecurityIdStreamName(streamName: string): string {
  const separatorIndex = streamName.indexOf("@");
  return separatorIndex > 0 ? streamName.slice(0, separatorIndex) : streamName;
}

function redactLoginToken(msg: unknown): unknown {
  if (!isRecord(msg)) return msg;
  const clone = cloneRecord(msg);
  const loginReq = clone.LoginReq;

  if (isRecord(loginReq)) {
    loginReq.Token = "[REDACTED]";
  }

  return clone;
}

const DEFAULT_STREAM_CONFIG: BrokerStreamConfig = {
  separator: "@",
  symbolFirst: true,
  companionSources: [],
  emitsUnclosedBars: false,
};

const BROKER_STREAM_CONFIG: Record<string, BrokerStreamConfig> = {
  alpaca: {
    separator: "@",
    symbolFirst: true,
    companionSources: ["alpaca_trading", "alpaca_news"],
    normalizeOrderSymbol: (symbol: string) => symbol.replace("/", ""),
    resolveSourceForSymbol: (symbol: string, defaultSource: string) =>
      symbol.includes("/") && defaultSource === "alpaca_stream"
        ? "alpaca_crypto"
        : defaultSource,
  },
  binance: {
    separator: "@",
    symbolFirst: true,
    companionSources: ["binance_trading"],
    emitsUnclosedBars: true,
    normalizeStreamType: (streamType: string) =>
      streamType === "liquidation"
        ? "forceOrder"
        : streamType === "continuous_kline" || streamType === "continuousKline"
          ? "continuousKline"
          : streamType,
  },

  dhan: {
    separator: "@",
    symbolFirst: true,
    companionSources: ["dhan_trading"],
    buildStreamNames: buildMetadataStreamNames,
    toRoutingStreamName: toSecurityIdStreamName,
    redactAuthMessage: redactLoginToken,
  },

  schwab: {
    separator: "@",
    symbolFirst: true,
    companionSources: ["schwab_trading"],
    tradingRoutingKey: () => "account_activity",
    unifiedSocket: true,
  },
  alpaca_trading: {
    separator: "@",
    symbolFirst: true,
    tradingRoutingKey: () => "trade_updates",
    tradingStreams: { account: ["trade_updates"] },
  },

  dhan_trading: {
    separator: "@",
    symbolFirst: true,
    tradingRoutingKey: () => "order_alert",
    tradingStreams: { account: ["order_alert"] },
    redactAuthMessage: redactLoginToken,
  },

  schwab_trading: {
    separator: "@",
    symbolFirst: true,
    tradingRoutingKey: () => "account_activity",
    tradingStreams: { account: ["account_activity"] },
    unifiedSocket: true,
  },
  binance_trading: {
    separator: "@",
    symbolFirst: true,
    tradingRoutingKey: (eventType: string) => eventType,
    tradingStreams: {
      spot: [
        "executionReport",
        "outboundAccountPosition",
        "balanceUpdate",
        "listenKeyExpired",
      ],
      futures: [
        "ORDER_TRADE_UPDATE",
        "ALGO_UPDATE",
        "ACCOUNT_UPDATE",
        "ACCOUNT_CONFIG_UPDATE",
        "MARGIN_CALL",
        "listenKeyExpired",
      ],
    },
  },
};

export function getBrokerStreamConfig(source: string): BrokerStreamConfig {
  const base = String(source || "").split("_")[0];
  return (
    BROKER_STREAM_CONFIG[source] ||
    BROKER_STREAM_CONFIG[base] ||
    DEFAULT_STREAM_CONFIG
  );
}

export function computeTradingNativeStreamsFromConfig(
  source: string,
  marketType?: string,
): string[] {
  const cfg = getBrokerStreamConfig(source);
  if (!cfg.tradingStreams) return [];
  const normalizedMarketType = String(marketType || "").toLowerCase();
  if (normalizedMarketType === "spot") {
    return cfg.tradingStreams.spot ?? cfg.tradingStreams.account ?? [];
  }
  if (normalizedMarketType === "futures") {
    return cfg.tradingStreams.futures ?? cfg.tradingStreams.account ?? [];
  }
  return (
    cfg.tradingStreams.account ??
    cfg.tradingStreams.spot ??
    cfg.tradingStreams.futures ??
    []
  );
}

export function getCompanionSources(source: MarketSource | string): string[] {
  return [...(getBrokerStreamConfig(source).companionSources || [])];
}
