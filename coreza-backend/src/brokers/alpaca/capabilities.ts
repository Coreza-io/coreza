import { BrokerCapabilities } from "../capabilities";
import { extractAlpacaOrderOwnerIds } from "./orderOwnerExtract";

const KNOWN_CRYPTO_QUOTES = ["USD", "USDT", "USDC", "BTC"];

function toCanonicalCryptoSymbol(symbol: string): string {
  const fallbackSymbol = "ETH/USD";
  if (!symbol || typeof symbol !== "string") return fallbackSymbol;

  const upperSymbol = symbol.toUpperCase().replace(/\s+/g, "");
  if (upperSymbol.includes("/")) {
    const [rawBase, rawQuote] = upperSymbol.split("/");
    if (rawBase && rawQuote) return `${rawBase}/${rawQuote}`;
    return fallbackSymbol;
  }

  const detectedQuote = KNOWN_CRYPTO_QUOTES.find(
    (quote) => upperSymbol.endsWith(quote) && upperSymbol.length > quote.length,
  );

  if (detectedQuote) {
    const base = upperSymbol.slice(0, -detectedQuote.length);
    return `${base}/${detectedQuote}`;
  }

  return fallbackSymbol;
}

export const alpacaCapabilities: BrokerCapabilities = {
  id: "alpaca",
  displayName: "Alpaca",

  nodeNames: {
    data: "Alpaca",
    trade: "AlpacaTrade",
    screener: "AlpacaScreener",
    subscribe: "AlpacaSubscribe",
    streamData: "AlpacaStreamData",
    news: "AlpacaNews",
  },

  streaming: {
    sourceId: "alpaca_stream",
    tradingSourceId: "alpaca_trading",
    tradingStreams: ["trade_updates"],
    newsSourceId: "alpaca_news",
  },

  streamParser: {
    separator: ".",
    eventFirst: true,
  },

  normalizeSymbol: (symbol: string, assetType?: string) => {
    if (assetType === "crypto") {
      return toCanonicalCryptoSymbol(symbol);
    }
    return symbol;
  },

  normalizeCryptoParams: (params: Record<string, any>) => {
    const fallbackSymbol = "ETH/USD";
    const normalizePair = (base: string, quote: string) =>
      `${base.toUpperCase().trim()}/${quote.toUpperCase().trim()}`;

    if (params.crypto_base) {
      const quote = params.crypto_quote || "USD";
      params.symbol = normalizePair(params.crypto_base, quote);
      return;
    }

    if (typeof params.symbol !== "string" || params.symbol.trim() === "") {
      params.symbol = fallbackSymbol;
      return;
    }

    params.symbol = toCanonicalCryptoSymbol(params.symbol);
  },

  orderOwnerExtract: extractAlpacaOrderOwnerIds,

  tradingRoutingKey: (_eventType: string) => "trade_updates",

  credentialValidation: {
    requiredFields: [
      { key: "api_key", label: "Alpaca API key", minLength: 10 },
      { key: "secret_key", label: "Alpaca secret key", minLength: 10 },
    ],
  },

  assetTypes: ["stock", "crypto"],

  toolDescriptions: {
    data: "Request historical or real-time market data from Alpaca.",
    trade:
      "Execute trades on Alpaca including market, limit, stop, and trailing stop orders.",
    screener:
      "Screen stocks using Alpaca screener APIs (market cap, volume, sector).",
  },
};
