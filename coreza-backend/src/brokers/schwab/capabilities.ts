import { BrokerCapabilities } from "../capabilities";
import { extractSchwabOrderOwnerIds } from "./orderOwnerExtract";

export const schwabCapabilities: BrokerCapabilities = {
  id: "schwab",
  displayName: "Schwab",

  nodeNames: {
    data: "Schwab",
    trade: "SchwabTrade",
    screener: "SchwabScreener",
    streamData: "SchwabStreamListener",
    subscribe: "SchwabStreamSubscribe",
  },

  streaming: {
    sourceId: "schwab_stream",
    tradingSourceId: "schwab_trading",
    tradingStreams: ["account_activity"],
  },

  streamParser: {
    separator: "@",
    symbolFirst: true,
  },

  orderOwnerExtract: extractSchwabOrderOwnerIds,

  tradingRoutingKey: () => "account_activity",

  supportsAlgoOrders: false,

  assetTypes: ["equity", "options"],

  toolDescriptions: {
    data: "Access equity market data from Charles Schwab.",
    trade: "Place or manage trades via Charles Schwab APIs.",
    screener:
      "Run Charles Schwab screeners to discover equities meeting criteria.",
  },
};
