import { BrokerCapabilities } from "../capabilities";
import { extractDhanOrderOwnerIds } from "./orderOwnerExtract";

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

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

  placeOrderEnrichment: {
    operation: "get_order_by_id",
    getOrderId: (data: unknown) => {
      const record = toRecord(data);
      const orderId = record?.orderId ?? record?.order_id;
      return orderId != null ? String(orderId) : undefined;
    },
    merge: (placeData: unknown, detail: unknown) => {
      const placeRecord = toRecord(placeData);
      const detailRecord = toRecord(Array.isArray(detail) ? detail[0] : detail);
      return placeRecord && detailRecord
        ? { ...placeRecord, ...detailRecord }
        : placeData;
    },
    pollAttempts: 3,
    pollDelayMs: 400,
  },

  tradingRoutingKey: () => "order_alert",

  supportsAlgoOrders: false,

  assetTypes: ["equity"],

  toolDescriptions: {
    data: "Fetch market data from Dhan for Indian markets.",
    trade: "Execute equity trades on Dhan with basic order operations.",
  },
};
