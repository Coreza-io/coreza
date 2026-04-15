import { BrokerConfig } from "../../types";
import { binanceOperations } from "./operations";

export const binanceConfig: BrokerConfig = {
  authType: "api_key",
  baseUrl: (creds: any, input?: any) => {
    if (input?.marketType === "futures") {
      return input?.environment === "live"
        ? "https://fapi.binance.com"
        : "https://demo-fapi.binance.com/fapi";
    }
    return input?.environment === "live"
      ? "https://api.binance.com"
      : "https://testnet.binance.vision/api";
  },
  makeAuthHeaders: (creds: any) => ({
    "X-MBX-APIKEY": creds.api_key,
  }),
  operations: binanceOperations,
};
