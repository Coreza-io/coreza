import { BrokerCapabilities } from "../capabilities";

export const schwabCapabilities: BrokerCapabilities = {
  id: "schwab",
  displayName: "Schwab",

  nodeNames: {
    data: "Schwab",
    trade: "SchwabTrade",
    screener: "SchwabScreener",
  },

  streaming: {
    sourceId: "schwab_stream",
  },

  streamParser: {
    separator: "@",
    symbolFirst: true,
  },

  supportsAlgoOrders: false,

  assetTypes: ["equity", "options"],

  toolDescriptions: {
    data: "Access equity market data from Charles Schwab.",
    trade: "Place or manage trades via Charles Schwab APIs.",
    screener:
      "Run Charles Schwab screeners to discover equities meeting criteria.",
  },
};
