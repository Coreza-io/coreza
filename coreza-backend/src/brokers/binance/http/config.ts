import { BrokerConfig } from "../../types";
import { binanceOperations } from "./operations";

export const binanceConfig: BrokerConfig = {
  authType: "api_key",

  baseUrl: (creds: any, input?: any) => {
    const assetType = input?.marketType;
    const environment = input?.environment || creds?.environment || "testnet";

    if (assetType === "futures") {
      return environment === "live"
        ? "https://fapi.binance.com"
        : "https://demo-fapi.binance.com";
    }

    return environment === "live"
      ? "https://api.binance.com"
      : "https://testnet.binance.vision";
  },

  makeAuthHeaders: (creds: any) => ({
    "X-MBX-APIKEY": creds.api_key,
  }),

  operations: binanceOperations,
};
