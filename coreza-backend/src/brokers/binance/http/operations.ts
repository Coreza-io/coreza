import axios from "axios";
import { getBinanceTimestamp } from "../../../utils/binanceTimeSync";
import { signHmacSha256 } from "../../../utils/crypto";
import { BrokerOperation, toBarSeries } from "../../types";
import { fromBinanceBar, parseBinanceKline } from "../helpers";

function getMarketType(input: any): "spot" | "futures" {
  return (input?.marketType || "spot") === "futures" ? "futures" : "spot";
}

function getEnvironment(input: any): "live" | "testnet" {
  return input?.environment === "testnet" ? "testnet" : "live";
}

function buildSignedParams(
  input: any,
  creds: any,
  params: Record<string, any>,
): Record<string, any> {
  const environment = getEnvironment(input);
  const marketType = getMarketType(input);
  const timestamp = getBinanceTimestamp(environment, marketType);

  const signed = signHmacSha256(
    {
      ...params,
      recvWindow: 60000,
      timestamp,
    },
    creds.secret_key,
  );

  return signed.signedParams;
}

export const binanceOperations: Record<string, BrokerOperation> = {
  get_account: {
    method: "get",
    path: (input: any) => {
      const marketType = getMarketType(input);
      return marketType === "futures" ? "/fapi/v3/account" : "/api/v3/account";
    },
    makeParams: (input: any, creds: any) => {
      return buildSignedParams(input, creds, {});
    },
  },

  get_positions: {
    method: "get",
    path: (input: any) => {
      const marketType = getMarketType(input);
      if (marketType !== "futures") {
        throw new Error("get_positions is only supported for futures accounts");
      }

      return "/fapi/v3/positionRisk";
    },
    makeParams: (input: any, creds: any) => {
      const environment = getEnvironment(input);
      const marketType = getMarketType(input);

      if (marketType !== "futures") {
        throw new Error("get_positions is only supported for futures accounts");
      }

      const timestamp = getBinanceTimestamp(environment, marketType);
      const params: Record<string, any> = {
        recvWindow: 5000,
        timestamp,
      };

      if (input?.symbol) {
        params.symbol = String(input.symbol).toUpperCase();
      }

      return buildSignedParams(input, creds, params);
    },
    transformResult: (raw: any) => {
      return {
        positions: raw,
      };
    },
  },

  get_orders: {
    method: "get",
    path: (input: any) => {
      const marketType = getMarketType(input);
      return marketType === "futures"
        ? "/fapi/v1/allOrders"
        : "/api/v3/allOrders";
    },
    makeParams: (input: any, creds: any) => {
      if (!input?.symbol) {
        throw new Error("symbol is required for get_orders");
      }

      const environment = getEnvironment(input);
      const marketType = getMarketType(input);
      const timestamp = getBinanceTimestamp(environment, marketType);

      const params: Record<string, any> = {
        symbol: String(input.symbol).toUpperCase(),
        recvWindow: 5000,
        timestamp,
      };

      if (input?.limit) params.limit = input.limit;
      if (input?.startTime)
        params.startTime = new Date(input.startTime).getTime();
      if (input?.endTime) params.endTime = new Date(input.endTime).getTime();
      if (input?.orderId) params.orderId = input.orderId;

      return buildSignedParams(input, creds, params);
    },
    transformResult: (raw: any) => {
      return {
        orders: raw,
      };
    },
  },

  get_trades: {
    method: "get",
    path: (input: any) => {
      const marketType = getMarketType(input);
      return marketType === "futures"
        ? "/fapi/v1/userTrades"
        : "/api/v3/myTrades";
    },
    makeParams: (input: any, creds: any) => {
      if (!input?.symbol) {
        throw new Error("symbol is required for get_trades");
      }

      const environment = getEnvironment(input);
      const marketType = getMarketType(input);
      const timestamp = getBinanceTimestamp(environment, marketType);

      const params: Record<string, any> = {
        symbol: String(input.symbol).toUpperCase(),
        recvWindow: 5000,
        timestamp,
      };

      if (input?.orderId) params.orderId = input.orderId;
      if (input?.startTime)
        params.startTime = new Date(input.startTime).getTime();
      if (input?.endTime) params.endTime = new Date(input.endTime).getTime();
      if (input?.fromId) params.fromId = input.fromId;
      if (input?.limit) params.limit = input.limit;

      return buildSignedParams(input, creds, params);
    },
    transformResult: (raw: any) => {
      return {
        trades: raw,
      };
    },
  },

  cancel_order: {
    method: "delete",
    path: (input: any) => {
      const marketType = getMarketType(input);
      return marketType === "futures" ? "/fapi/v1/order" : "/api/v3/order";
    },
    makeParams: (input: any, creds: any) => {
      if (!input?.symbol) {
        throw new Error("symbol is required for cancel_order");
      }
      if (!input?.order_id && !input?.origClientOrderId) {
        throw new Error(
          "Either order_id or origClientOrderId is required for cancel_order",
        );
      }

      const environment = getEnvironment(input);
      const marketType = getMarketType(input);
      const timestamp = getBinanceTimestamp(environment, marketType);

      const params: Record<string, any> = {
        symbol: String(input.symbol).toUpperCase(),
        recvWindow: 5000,
        timestamp,
      };

      if (input?.order_id) params.orderId = input.order_id;
      if (input?.origClientOrderId)
        params.origClientOrderId = input.origClientOrderId;

      return buildSignedParams(input, creds, params);
    },
  },

  get_candle: {
    method: "get",
    path: (input: any) => {
      const marketType = getMarketType(input);
      return marketType === "futures" ? "/fapi/v1/klines" : "/api/v3/klines";
    },
    makeParams: (input: any) => {
      if (!input?.symbol) {
        throw new Error("symbol is required for get_candle");
      }

      const params: Record<string, any> = {
        symbol: String(input.symbol).toUpperCase(),
        interval: input.interval || "1h",
      };

      if (input?.limit) params.limit = input.limit;
      if (input?.startTime)
        params.startTime = new Date(input.startTime).getTime();
      if (input?.endTime) params.endTime = new Date(input.endTime).getTime();

      return params;
    },
    transformResult: (raw: any, input: any) => {
      if (!Array.isArray(raw)) {
        return toBarSeries(input.symbol, input.interval || "1h", []);
      }

      const bars = raw.map((k: any) => fromBinanceBar(parseBinanceKline(k)));
      return toBarSeries(input.symbol, input.interval || "1h", bars);
    },
  },

  get_ticker: {
    method: "get",
    path: (input: any) => {
      const marketType = getMarketType(input);
      return marketType === "futures"
        ? "/fapi/v1/ticker/24hr"
        : "/api/v3/ticker/24hr";
    },
    makeParams: (input: any) => {
      const params: Record<string, any> = {};
      if (input?.symbol) params.symbol = String(input.symbol).toUpperCase();
      return params;
    },
  },

  place_order: {
    method: "post",
    path: (input: any) => {
      const marketType = getMarketType(input);
      return marketType === "futures" ? "/fapi/v1/order" : "/api/v3/order";
    },
    makeParams: (input: any, creds: any) => {
      const {
        symbol,
        side,
        type,
        quantity,
        price,
        stopPrice,
        timeInForce,
        icebergQty,
        newOrderRespType,
      } = input ?? {};

      if (!symbol) throw new Error("symbol is required for place_order");
      if (!side) throw new Error("side is required for place_order");
      if (!type) throw new Error("type is required for place_order");
      if (quantity == null)
        throw new Error("quantity is required for place_order");

      const environment = getEnvironment(input);
      const marketType = getMarketType(input);
      const timestamp = getBinanceTimestamp(environment, marketType);

      const upperType = String(type).toUpperCase();

      const params: Record<string, any> = {
        symbol: String(symbol).toUpperCase(),
        side: String(side).toUpperCase(),
        type: upperType,
        quantity: String(quantity),
        recvWindow: 5000,
        timestamp,
      };

      if (
        ["LIMIT", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT"].includes(upperType)
      ) {
        params.timeInForce = timeInForce || "GTC";

        if (price == null) {
          throw new Error("price is required for limit-style orders");
        }
        params.price = String(price);
      }

      if (
        [
          "STOP_LOSS",
          "STOP_LOSS_LIMIT",
          "TAKE_PROFIT",
          "TAKE_PROFIT_LIMIT",
        ].includes(upperType)
      ) {
        if (stopPrice == null) {
          throw new Error("stopPrice is required for stop orders");
        }
        params.stopPrice = String(stopPrice);
      }

      if (icebergQty != null) params.icebergQty = String(icebergQty);
      if (newOrderRespType) params.newOrderRespType = newOrderRespType;
      if (input?._idempotencyKey) {
        params.newClientOrderId = input._idempotencyKey;
      }

      return buildSignedParams(input, creds, params);
    },
  },
};
