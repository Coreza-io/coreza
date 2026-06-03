import { BrokerCapabilities } from "../capabilities";
import { extractDhanOrderOwnerIds } from "./orderOwnerExtract";

export const dhanCapabilities: BrokerCapabilities = {
  id: "dhan",
  displayName: "Dhan",

  nodeNames: {
    data: "Dhan",
    trade: "DhanTrade",
    subscribe: "DhanSubscribe",
    streamData: "DhanStreamData",
  },

  streaming: {
    sourceId: "dhan_stream",
    tradingSourceId: "dhan_trading",
    tradingStreams: ["order_alert"],
  },

  streamParser: {
    separator: "@",
    symbolFirst: true,
  },

  credentialValidation: {
    requiredFields: [
      { key: "client_id", label: "Dhan client ID" },
      { key: "api_key", label: "Dhan access token" },
    ],
  },

  orderOwnerExtract: extractDhanOrderOwnerIds,

  tradingRoutingKey: () => "order_alert",

  supportsAlgoOrders: false,

  assetTypes: ["equity"],

  toolDescriptions: {
    data: "Fetch market data from Dhan for Indian markets.",
    trade: "Execute equity trades on Dhan with basic order operations.",
  },
};
