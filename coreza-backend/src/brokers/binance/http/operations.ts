import { interval } from "date-fns";
import { getBinanceTimestamp } from "../../../utils/binanceTimeSync";
import { signHmacSha256 } from "../../../utils/crypto";
import { BrokerOperation, toBarSeries } from "../../types";
import { fromBinanceBar, parseBinanceKline } from "../helpers";

export const binanceOperations: Record<string, BrokerOperation> = {
  get_account: {
    method: "get",
    path: (input: any) => {
      const marketType = input?.marketType || "spot";
      return marketType === "futures" ? "/fapi/v2/account" : "/api/v3/account";
    },
    makeParams: (input: any, creds: any) => {
      const environment = input?.environment || "live";
      const marketType = input?.marketType || "spot";
      const timestamp = getBinanceTimestamp(environment, marketType);
      const recvWindow = 5000;
      const params = {
        recvWindow,
        timestamp,
      };

      return signHmacSha256(params, creds.secret_key);
    },
  },
  get_positions: {
    method: "get",
    path: (input: any) => {
      const marketType = input?.marketType || "futures";
      if (marketType !== "futures") {
        throw new Error("get_positions is only supported for futures accounts");
      }

      return "/fapi/v2/positionRisk";
    },
    makeParams: (input: any, creds: any) => {
      const environment = input?.environment || "live";
      const marketType = input?.marketType || "futures";

      if (marketType !== "futures") {
        throw new Error("get_positions is only supported for futures accounts");
      }

      const timestamp = getBinanceTimestamp(environment, marketType);
      const recvWindow = 5000;
      const params: any = {};

      if (input.symbol) {
        params.symbol = input.symbol;
      }

      params.recvWindow = recvWindow;
      params.timestamp = timestamp;

      return signHmacSha256(params, creds.secret_key);
    },
    transformResult: (raw: any, input: any) => {
      return {
        positions: raw,
      };
    },
  },
  get_orders: {
    method: "get",
    path: (input: any) => {
      const marketType = input?.marketType || "spot";
      return marketType === "futures"
        ? "/fapi/v1/allOrders"
        : "/api/v3/allOrders";
    },
    makeParams: (input: any, creds: any) => {
      const environment = input?.environment || "live";
      const marketType = input?.marketType || "spot";
      const timestamp = getBinanceTimestamp(environment, marketType);
      const recvWindow = 5000;
      const params: any = { recvWindow, timestamp };

      if (!input.symbol) throw new Error("symbol is required for get_orders");
      params.symbol = input.symbol;
      if (input.limit) params.limit = input.limit;
      if (input.startTime)
        params.startTime = new Date(input.startTime).getTime();
      if (input.endTime) params.endTime = new Date(input.endTime).getTime();

      return signHmacSha256(params, creds.secret_key);
    },
    transformResult: (raw: any, input: any) => {
      return {
        orders: raw,
      };
    },
  },
  get_trades: {
    method: "get",
    path: (input: any) => {
      const marketType = input?.marketType || "spot";
      return marketType === "futures"
        ? "/fapi/v1/userTrades"
        : "/api/v3/myTrades";
    },
    makeParams: (input: any, creds: any) => {
      if (!input.symbol) throw new Error("symbol is required for get_trades");

      const environment = input?.environment || "live";
      const marketType = input?.marketType || "spot";
      const timestamp = getBinanceTimestamp(environment, marketType);
      const recvWindow = 5000;
      const params: any = {
        symbol: input.symbol,
        recvWindow,
        timestamp,
      };

      if (input.orderId) params.orderId = input.orderId;
      if (input.startTime)
        params.startTime = new Date(input.startTime).getTime();
      if (input.endTime) params.endTime = new Date(input.endTime).getTime();
      if (input.fromId) params.fromId = input.fromId;
      if (input.limit) params.limit = input.limit;

      return signHmacSha256(params, creds.secret_key);
    },
    transformResult: (raw: any, input: any) => {
      return {
        trades: raw,
      };
    },
  },
  cancel_order: {
    method: "delete",
    path: (input: any) => {
      const marketType = input?.marketType || "spot";
      return marketType === "futures" ? "/fapi/v1/order" : "/api/v3/order";
    },
    makeParams: (input: any, creds: any) => {
      if (!input.symbol) throw new Error("symbol is required for cancel_order");
      if (!input.order_id)
        throw new Error("order_id is required for cancel_order");

      const environment = input?.environment || "live";
      const marketType = input?.marketType || "spot";
      const timestamp = getBinanceTimestamp(environment, marketType);
      const recvWindow = 5000;
      const params: any = {
        symbol: input.symbol,
        orderId: input.order_id,
        recvWindow,
        timestamp,
      };

      return signHmacSha256(params, creds.secret_key);
    },
  },
  get_candle: {
    method: "get",
    path: (input: any) => {
      const marketType = input?.marketType || "spot";
      return marketType === "futures" ? "/fapi/v1/klines" : "/api/v3/klines";
    },
    makeParams: (input: any) => {
      if (!input.symbol) throw new Error("symbol is required for get_candle");

      const params: any = {
        symbol: input.symbol,
        interval: input.interval || "1h",
      };

      if (input.limit) params.limit = input.limit;
      if (input.startTime)
        params.startTime = new Date(input.startTime).getTime();
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
      const marketType = input?.marketType || "spot";
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
      const marketType = input?.marketType || "spot";
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
      if (!quantity) throw new Error("quantity is required for place_order");

      const environment = input?.environment || "live";
      const marketType = input?.marketType || "spot";
      const timestamp = getBinanceTimestamp(environment, marketType);
      const recvWindow = 5000;
      const params: any = {
        symbol: symbol.toUpperCase(),
        side: side.toUpperCase(),
        type: type.toUpperCase(),
        quantity: String(quantity),
        recvWindow,
        timestamp,
      };

      if (
        ["LIMIT", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT"].includes(
          type.toUpperCase(),
        )
      ) {
        params.timeInForce = timeInForce || "GTC";
      }

      if (
        ["LIMIT", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT"].includes(
          type.toUpperCase(),
        )
      ) {
        if (!price) throw new Error("price is required for limit orders");
        params.price = String(price);
      }

      if (
        [
          "STOP_LOSS",
          "STOP_LOSS_LIMIT",
          "TAKE_PROFIT",
          "TAKE_PROFIT_LIMIT",
        ].includes(type.toUpperCase())
      ) {
        if (!stopPrice)
          throw new Error("stopPrice is required for stop orders");
        params.stopPrice = String(stopPrice);
      }

      if (icebergQty) params.icebergQty = String(icebergQty);
      if (newOrderRespType) params.newOrderRespType = newOrderRespType;
      if (input._idempotencyKey)
        params.newClientOrderId = input._idempotencyKey;

      return signHmacSha256(params, creds.secret_key);
    },
    // transformResult: (raw: any) => ({
    //   orderId: raw.orderId,
    //   symbol: raw.symbol,
    //   status: raw.status,
    //   executedQty: raw.executedQty,
    //   price: raw.price,
    //   side: raw.side,
    // }),
  },
};
