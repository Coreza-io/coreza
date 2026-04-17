import { getBinanceTimestamp } from "../../../utils/binanceTimeSync";
import { signHmacSha256 } from "../../../utils/crypto";
import { BrokerOperation, toBarSeries } from "../../types";
import { fromBinanceBar, parseBinanceKline } from "../helpers";

function getMarketType(input: any): "spot" | "futures" {
  const marketType = input?.marketType ?? input?.asset_type ?? input?.assetType;
  return marketType === "futures" ? "futures" : "spot";
}

function getEnvironment(input: any): "live" | "testnet" {
  return input?.environment === "live" ? "live" : "testnet";
}

function signParams(creds: any, params: Record<string, any>) {
  return signHmacSha256(params, creds.secret_key);
}

export const binanceOperations: Record<string, BrokerOperation> = {
  get_account: {
    method: "get",
    path: (input: any) => {
      const marketType = getMarketType(input);
      return marketType === "futures" ? "/fapi/v2/account" : "/api/v3/account";
    },
    makeParams: (input: any, creds: any) => {
      const timestamp = getBinanceTimestamp(
        getEnvironment(input),
        getMarketType(input),
      );
      return signParams(creds, { recvWindow: 60000, timestamp });
    },
  },
  get_positions: {
    method: "get",
    path: () => "/fapi/v2/positionRisk",
    makeParams: (input: any, creds: any) => {
      const marketType = getMarketType(input);
      if (marketType !== "futures") {
        throw new Error("get_positions is only supported for futures accounts");
      }

      const params: Record<string, any> = {
        recvWindow: 60000,
        timestamp: getBinanceTimestamp(getEnvironment(input), marketType),
      };

      if (input.symbol) params.symbol = input.symbol;
      return signParams(creds, params);
    },
    transformResult: (raw: any) => ({
      positions: raw,
    }),
  },
  get_orders: {
    method: "get",
    path: (input: any) => {
      const marketType = getMarketType(input);
      return marketType === "futures" ? "/fapi/v1/allOrders" : "/api/v3/allOrders";
    },
    makeParams: (input: any, creds: any) => {
      if (!input.symbol) throw new Error("symbol is required for get_orders");

      const params: Record<string, any> = {
        symbol: input.symbol,
        recvWindow: 60000,
        timestamp: getBinanceTimestamp(getEnvironment(input), getMarketType(input)),
      };

      if (input.limit) params.limit = input.limit;
      if (input.startTime) params.startTime = new Date(input.startTime).getTime();
      if (input.endTime) params.endTime = new Date(input.endTime).getTime();

      return signParams(creds, params);
    },
    transformResult: (raw: any) => ({
      orders: raw,
    }),
  },
  get_trades: {
    method: "get",
    path: (input: any) => {
      const marketType = getMarketType(input);
      return marketType === "futures" ? "/fapi/v1/userTrades" : "/api/v3/myTrades";
    },
    makeParams: (input: any, creds: any) => {
      if (!input.symbol) throw new Error("symbol is required for get_trades");

      const params: Record<string, any> = {
        symbol: input.symbol,
        recvWindow: 60000,
        timestamp: getBinanceTimestamp(getEnvironment(input), getMarketType(input)),
      };

      if (input.orderId) params.orderId = input.orderId;
      if (input.startTime) params.startTime = new Date(input.startTime).getTime();
      if (input.endTime) params.endTime = new Date(input.endTime).getTime();
      if (input.fromId) params.fromId = input.fromId;
      if (input.limit) params.limit = input.limit;

      return signParams(creds, params);
    },
    transformResult: (raw: any) => ({
      trades: raw,
    }),
  },
  cancel_order: {
    method: "delete",
    path: (input: any) => {
      const marketType = getMarketType(input);
      return marketType === "futures" ? "/fapi/v1/order" : "/api/v3/order";
    },
    makeParams: (input: any, creds: any) => {
      if (!input.symbol) throw new Error("symbol is required for cancel_order");
      if (!input.order_id) throw new Error("order_id is required for cancel_order");

      return signParams(creds, {
        symbol: input.symbol,
        orderId: input.order_id,
        recvWindow: 60000,
        timestamp: getBinanceTimestamp(getEnvironment(input), getMarketType(input)),
      });
    },
  },
  get_candle: {
    method: "get",
    path: (input: any) => {
      const marketType = getMarketType(input);
      return marketType === "futures" ? "/fapi/v1/klines" : "/api/v3/klines";
    },
    makeParams: (input: any) => {
      if (!input.symbol) throw new Error("symbol is required for get_candle");

      const params: Record<string, any> = {
        symbol: input.symbol,
        interval: input.interval || "1h",
      };

      if (input.limit) params.limit = input.limit;
      if (input.startTime) params.startTime = new Date(input.startTime).getTime();
      if (input.endTime) params.endTime = new Date(input.endTime).getTime();

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
      const params: any = {};
      if (input.symbol) params.symbol = input.symbol;
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
      } = input;

      if (!symbol) throw new Error("symbol is required for place_order");
      if (!side) throw new Error("side is required for place_order");
      if (!type) throw new Error("type is required for place_order");
      if (!quantity && !input.closePosition) {
        throw new Error("quantity is required for place_order unless closePosition=true");
      }

      const marketType = getMarketType(input);
      const orderType = String(type).toUpperCase();

      const params: Record<string, any> = {
        symbol: symbol.toUpperCase(),
        side: side.toUpperCase(),
        type: orderType,
        recvWindow: 60000,
        timestamp: getBinanceTimestamp(getEnvironment(input), marketType),
      };

      if (!input.closePosition) {
        params.quantity = String(quantity);
      }

      const futuresLimitLikeTypes = [
        "LIMIT",
        "STOP",
        "TAKE_PROFIT",
      ];
      const spotLimitLikeTypes = ["LIMIT", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT"];
      const limitLikeTypes =
        marketType === "futures" ? futuresLimitLikeTypes : spotLimitLikeTypes;

      if (limitLikeTypes.includes(orderType)) {
        params.timeInForce = timeInForce || "GTC";
      }

      const needsPrice =
        marketType === "futures"
          ? ["LIMIT", "STOP", "TAKE_PROFIT"].includes(orderType)
          : ["LIMIT", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT"].includes(orderType);
      if (needsPrice) {
        if (!price) throw new Error("price is required for this order type");
        params.price = String(price);
      }

      const needsStopPrice =
        marketType === "futures"
          ? ["STOP", "STOP_MARKET", "TAKE_PROFIT", "TAKE_PROFIT_MARKET"].includes(
              orderType,
            )
          : ["STOP_LOSS", "STOP_LOSS_LIMIT", "TAKE_PROFIT", "TAKE_PROFIT_LIMIT"].includes(
              orderType,
            );
      if (needsStopPrice) {
        if (!stopPrice) throw new Error("stopPrice is required for this order type");
        params.stopPrice = String(stopPrice);
      }

      if (marketType === "futures") {
        if (input.positionSide) params.positionSide = input.positionSide;
        if (input.reduceOnly !== undefined) params.reduceOnly = input.reduceOnly;
        if (input.closePosition !== undefined) params.closePosition = input.closePosition;
        if (input.workingType) params.workingType = input.workingType;
        if (input.priceProtect !== undefined) params.priceProtect = input.priceProtect;

        if (orderType === "TRAILING_STOP_MARKET") {
          if (!input.callbackRate) {
            throw new Error("callbackRate is required for TRAILING_STOP_MARKET");
          }
          params.callbackRate = String(input.callbackRate);
          if (input.activationPrice) {
            params.activationPrice = String(input.activationPrice);
          }
        }
      } else {
        if (icebergQty) params.icebergQty = String(icebergQty);
      }

      if (newOrderRespType) params.newOrderRespType = newOrderRespType;
      if (input._idempotencyKey) params.newClientOrderId = input._idempotencyKey;

      return signParams(creds, params);
    },
  },
};
