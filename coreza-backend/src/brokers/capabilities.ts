/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

/**
 * BrokerCapabilities: Config-driven registry for all broker-specific behavior.
 * Adding a new broker = create a new capabilities config + node JSONs. Zero code changes elsewhere.
 */

export interface StreamIdentifier {
  symbol: string;
  eventType: string;
  interval?: string;
  contractType?: string;
}

export interface CredentialField {
  key: string;
  label: string;
  minLength?: number;
  pattern?: RegExp;
}

export interface StreamParserConfig {
  /** Separator used in market stream names: "." for Alpaca (bars.AAPL), "@" for Binance (btcusdt@kline_1m) */
  separator: "." | "@";
  /** If true, event type comes before separator, symbol after (Alpaca: bars.AAPL) */
  eventFirst?: boolean;
  /** If true, symbol comes before separator, event after (Binance: btcusdt@kline_1m) */
  symbolFirst?: boolean;
  /** Custom normalizer for event types (e.g., Binance liquidation → forceOrder) */
  normalizeEventType?: (eventType: string) => string;
  /** Custom parser for complex stream name formats */
  customParser?: (streamName: string) => StreamIdentifier;
  /** Custom stream name builder */
  customBuilder?: (
    symbol: string,
    eventType: string,
    interval?: string,
    contractType?: string,
  ) => string;
}

export interface BrokerCapabilities {
  /** Unique broker identifier, e.g. "alpaca", "binance" */
  id: string;

  /** Human-readable name, e.g. "Alpaca", "Binance" */
  displayName: string;

  /** Node names associated with this broker */
  nodeNames: {
    /** Market data node name, e.g. "Alpaca" */
    data: string;
    /** Trade node name (when __isTool toggled), e.g. "AlpacaTrade" */
    trade?: string;
    /** Screener node name, e.g. "AlpacaScreener" */
    screener?: string;
    /** Subscribe node name, e.g. "AlpacaSubscribe" */
    subscribe?: string;
    /** Stream data trigger node name, e.g. "AlpacaStreamData" */
    streamData?: string;
    /** News node name (if broker has dedicated news) */
    news?: string;
  };

  /** Streaming configuration */
  streaming: {
    /** Source ID for market data streaming, e.g. "alpaca_stream" */
    sourceId: string;
    /** Source ID for trading events, e.g. "alpaca_trading" */
    tradingSourceId?: string;
    /** Native trading stream names for this broker */
    tradingStreams?: string[];
    /** Spot-specific trading streams (Binance spot vs futures differentiation) */
    spotTradingStreams?: string[];
    /** News source ID if supported */
    newsSourceId?: string;
  };

  /** How to parse/build stream names for this broker */
  streamParser: StreamParserConfig;

  /** Symbol normalization (e.g., Alpaca crypto slash formatting) */
  normalizeSymbol?: (symbol: string, assetType?: string) => string;

  /** Normalize crypto symbol from composite params (crypto_base + crypto_quote) */
  normalizeCryptoParams?: (params: Record<string, any>) => void;

  /** Extract order owner IDs from broker response */
  orderOwnerExtract?: (data: any) => Record<string, string | undefined>;

  /** Trading routing key derivation */
  tradingRoutingKey?: (eventType: string) => string;

  /** Credential validation rules */
  credentialValidation?: {
    requiredFields: CredentialField[];
  };

  /** Supported asset types */
  assetTypes?: string[];

  /** Description for AI tool definitions */
  toolDescriptions?: {
    data?: string;
    trade?: string;
    screener?: string;
  };
}

// ============================================================
// Registry and lookup helpers
// ============================================================

/** All registered broker capabilities, keyed by broker ID */
export const BROKER_CAPABILITIES: Record<string, BrokerCapabilities> = {};

/** Register a broker's capabilities */
export function registerBrokerCapabilities(config: BrokerCapabilities): void {
  BROKER_CAPABILITIES[config.id] = config;
}

/** Reverse-lookup: find broker capabilities by any associated node name */
export function getBrokerByNodeName(
  nodeName: string,
): BrokerCapabilities | undefined {
  for (const cap of Object.values(BROKER_CAPABILITIES)) {
    const names = cap.nodeNames;
    if (
      names.data === nodeName ||
      names.trade === nodeName ||
      names.screener === nodeName ||
      names.subscribe === nodeName ||
      names.streamData === nodeName ||
      names.news === nodeName
    ) {
      return cap;
    }
  }
  return undefined;
}

/** Get all brokers that support streaming */
export function getStreamingBrokers(): BrokerCapabilities[] {
  return Object.values(BROKER_CAPABILITIES).filter(
    (b) => b.nodeNames.streamData,
  );
}

/** Get trading streams for a given trading source ID */
export function getTradingStreamsForSource(
  source: string,
  marketType?: string,
): string[] {
  for (const cap of Object.values(BROKER_CAPABILITIES)) {
    if (cap.streaming.tradingSourceId === source) {
      // If broker differentiates spot vs futures (e.g., Binance)
      if (marketType === "spot" && cap.streaming.spotTradingStreams) {
        return cap.streaming.spotTradingStreams;
      }
      return cap.streaming.tradingStreams || [];
    }
  }
  return [];
}

/** Check if a source ID is a trading source */
export function isTradingSource(source: string): boolean {
  return Object.values(BROKER_CAPABILITIES).some(
    (b) => b.streaming.tradingSourceId === source,
  );
}

/** Get order owner extractor for a broker */
export function getOrderOwnerExtractor(
  broker: string,
): ((data: any) => Record<string, string | undefined>) | undefined {
  return BROKER_CAPABILITIES[broker]?.orderOwnerExtract;
}

/** Get credential validation for a service type */
export function getCredentialValidation(
  serviceType: string,
): BrokerCapabilities["credentialValidation"] | undefined {
  return BROKER_CAPABILITIES[serviceType]?.credentialValidation;
}

/** Get all streaming data node names (for trigger classification) */
export function getStreamingNodeNames(): Set<string> {
  const names = new Set<string>();
  for (const cap of Object.values(BROKER_CAPABILITIES)) {
    if (cap.nodeNames.streamData) names.add(cap.nodeNames.streamData);
    if (cap.nodeNames.news) names.add(cap.nodeNames.news);
  }
  return names;
}

/** Auto-generate nodeNameToSourceMap from capabilities */
export function buildNodeNameToSourceMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const cap of Object.values(BROKER_CAPABILITIES)) {
    if (cap.nodeNames.streamData) {
      map[cap.nodeNames.streamData] = cap.streaming.sourceId;
    }
    if (cap.nodeNames.news && cap.streaming.newsSourceId) {
      map[cap.nodeNames.news] = cap.streaming.newsSourceId;
    }
  }
  return map;
}

/** Auto-generate executor category map for tool/AI agent delegation */
export function buildExecutorCategoryMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const cap of Object.values(BROKER_CAPABILITIES)) {
    // Data nodes → "Market" (for broker-direct market data)
    map[cap.nodeNames.data] = "Market";
    // Trade nodes → "Broker"
    if (cap.nodeNames.trade) map[cap.nodeNames.trade] = "Broker";
    // Screener nodes → "Screener"
    if (cap.nodeNames.screener) map[cap.nodeNames.screener] = "Screener";
  }
  return map;
}

/** Auto-generate tool definitions from capabilities */
export function buildToolDefinitions(): Record<
  string,
  { description: string; category: string }
> {
  const defs: Record<string, { description: string; category: string }> = {};
  for (const cap of Object.values(BROKER_CAPABILITIES)) {
    if (cap.toolDescriptions?.data) {
      defs[cap.nodeNames.data] = {
        description: cap.toolDescriptions.data,
        category: "Broker",
      };
    }
    if (cap.toolDescriptions?.trade && cap.nodeNames.trade) {
      defs[cap.nodeNames.trade] = {
        description: cap.toolDescriptions.trade,
        category: "Broker",
      };
    }
    if (cap.toolDescriptions?.screener && cap.nodeNames.screener) {
      defs[cap.nodeNames.screener] = {
        description: cap.toolDescriptions.screener,
        category: "Screener",
      };
    }
  }
  return defs;
}

/** Get all market data node names (broker data nodes) */
export function getMarketDataNodeNames(): string[] {
  return Object.values(BROKER_CAPABILITIES).map((b) => b.nodeNames.data);
}

/** Get all screener node names */
export function getScreenerNodeNames(): string[] {
  return Object.values(BROKER_CAPABILITIES)
    .filter((b) => b.nodeNames.screener)
    .map((b) => b.nodeNames.screener!);
}

/** Get all trade node names */
export function getTradeNodeNames(): string[] {
  return Object.values(BROKER_CAPABILITIES)
    .filter((b) => b.nodeNames.trade)
    .map((b) => b.nodeNames.trade!);
}

/** Check if a node name belongs to any broker */
export function isBrokerNode(nodeName: string): boolean {
  return getBrokerByNodeName(nodeName) !== undefined;
}

/** Get trading routing key for a source */
export function getTradingRoutingKey(
  source: string,
  eventType: string,
): string {
  for (const cap of Object.values(BROKER_CAPABILITIES)) {
    if (cap.streaming.tradingSourceId === source) {
      return cap.tradingRoutingKey
        ? cap.tradingRoutingKey(eventType)
        : eventType;
    }
  }
  throw new Error(`Unsupported trading source for routing key: ${source}`);
}

/** Resolve stream source ID from broker + asset type */
export function resolveStreamSourceFromBroker(
  source: string,
  assetType?: string,
  category?: string,
): string {
  const cap = BROKER_CAPABILITIES[source];
  if (!cap) {
    // Fallback for unknown sources
    if (category) return `${source}_${category.toLowerCase()}`;
    if (assetType) return `${source}_${assetType.toLowerCase()}`;
    return source;
  }

  const normalizedAsset = (assetType || "").toLowerCase();
  const normalizedCategory = (category || "").toLowerCase();

  // Check if broker has a news source and asset type matches
  if (normalizedAsset === "news" && cap.streaming.newsSourceId) {
    return cap.streaming.newsSourceId;
  }

  if (normalizedCategory) {
    return `${source}_${normalizedCategory}`;
  }

  if (normalizedAsset) {
    return `${source}_${normalizedAsset}`;
  }

  return source;
}

/** Parse a stream name using broker-specific rules */
export function parseStreamNameBySource(
  source: string,
  streamName: string,
): StreamIdentifier {
  // Find the broker for this source
  const brokerKey = source.split("_")[0];
  const cap = BROKER_CAPABILITIES[brokerKey];

  if (cap?.streamParser.customParser) {
    return cap.streamParser.customParser(streamName);
  }

  if (!cap) {
    // Generic fallback: try @ separator
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

  const { separator, eventFirst } = cap.streamParser;

  if (separator === ".") {
    // Alpaca style: eventType.SYMBOL
    const dotIndex = streamName.indexOf(".");
    if (dotIndex === -1) {
      return { symbol: streamName.toUpperCase(), eventType: "unknown" };
    }
    if (eventFirst) {
      return {
        symbol: streamName.slice(dotIndex + 1).toUpperCase(),
        eventType: streamName.slice(0, dotIndex),
      };
    }
    return {
      symbol: streamName.slice(0, dotIndex).toUpperCase(),
      eventType: streamName.slice(dotIndex + 1),
    };
  }

  // @ separator (Binance style): symbol@eventType_interval
  const atIndex = streamName.indexOf("@");
  if (atIndex === -1) {
    return { symbol: streamName.toUpperCase(), eventType: "unknown" };
  }

  const rawSymbol = streamName.slice(0, atIndex);
  const typeWithInterval = streamName.slice(atIndex + 1);

  // Normalize event type if broker provides normalizer
  const normalizeEventType = cap.streamParser.normalizeEventType;

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
    let eventType = typeWithInterval.slice(0, underscoreIndex);
    const interval = typeWithInterval.slice(underscoreIndex + 1);

    if (normalizeEventType) {
      eventType = normalizeEventType(eventType);
    }

    if (eventType === "continuous_kline" || eventType === "continuousKline") {
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

  const resolvedEventType = normalizeEventType
    ? normalizeEventType(typeWithInterval)
    : typeWithInterval;
  return { symbol: rawSymbol.toUpperCase(), eventType: resolvedEventType };
}

/** Build a stream name using broker-specific rules */
export function buildStreamNameBySource(
  source: string,
  symbol: string,
  eventType: string,
  interval?: string,
  contractType?: string,
): string {
  const brokerKey = source.split("_")[0];
  const cap = BROKER_CAPABILITIES[brokerKey];

  if (cap?.streamParser.customBuilder) {
    return cap.streamParser.customBuilder(
      symbol,
      eventType,
      interval,
      contractType,
    );
  }

  if (cap?.streamParser.separator === ".") {
    // Alpaca style: eventType.SYMBOL
    return `${eventType}.${symbol}`;
  }

  // Default: @ separator (Binance style)
  const normalizeEventType = cap?.streamParser.normalizeEventType;
  const resolvedEventType = normalizeEventType
    ? normalizeEventType(eventType)
    : eventType;

  const normalizedContractType = contractType || "perpetual";
  const sym =
    resolvedEventType === "continuous_kline"
      ? `${symbol.toLowerCase()}_${normalizedContractType}`
      : symbol.toLowerCase();

  return interval
    ? `${sym}@${resolvedEventType}_${interval}`
    : `${sym}@${resolvedEventType}`;
}
