import { getBinanceTimestamp } from "../../../utils/binanceTimeSync";
import { signHmacSha256 } from "../../../utils/crypto";
import { BrokerOperation } from "../../types";

export const binanceOperations: Record<string, BrokerOperation> = {
  get_account: {
    method: "get",
    path: (input: any) => {
      const assetType = input?.asset_type || "spot";
      return assetType === "futures" ? "/fapi/v2/account" : "/api/v3/account";
    },
    makeParams: (input: any, creds: any) => {
      const environment = input?.environment || "live";
      const assetType = input?.asset_type || "spot";
      const timestamp = getBinanceTimestamp(environment, assetType);
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
      const assetType = input?.asset_type || "futures";
      if (assetType !== "futures") {
        throw new Error("get_positions is only supported for futures accounts");
      }

      return "/fapi/v2/positionRisk";
    },
    makeParams: (input: any, creds: any) => {
      const environment = input?.environment || "live";
      const assetType = input?.asset_type || "futures";

      if (assetType !== "futures") {
        throw new Error("get_positions is only supported for futures accounts");
      }

      const timestamp = getBinanceTimestamp(environment, assetType);
      const recvWindow = 5000;
      const params: any = {};

      if (input.symbol) {
        params.symbol = input.symbol;
      }

      params.recvWindow = recvWindow;
      params.timestamp = timestamp;

      return signHmacSha256(params, creds.secret_key);
    },
  },
  get_orders: {
    method: "get",
    path: (input: any) => {
      const assetType = input?.asset_type || "spot";
      return assetType === "futures"
        ? "/fapi/v1/allOrders"
        : "/api/v3/allOrders";
    },
    makeParams: (input: any, creds: any) => {
      const environment = input?.environment || "live";
      const assetType = input?.asset_type || "spot";
      const timestamp = getBinanceTimestamp(environment, assetType);
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
  },
  get_trades: {
    method: "get",
    path: (input: any) => {
      const assetType = input?.asset_type || "spot";
      return assetType === "futures"
        ? "/fapi/v1/userTrades"
        : "/api/v3/myTrades";
    },
    makeParams: (input: any, creds: any) => {
      if (!input.symbol) throw new Error("symbol is required for get_trades");

      const environment = input?.environment || "live";
      const assetType = input?.asset_type || "spot";
      const timestamp = getBinanceTimestamp(environment, assetType);
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
  },
  cancel_order: {
    method: "delete",
    path: (input: any) => {
      const assetType = input?.asset_type || "spot";
      return assetType === "futures" ? "/fapi/v1/order" : "/api/v3/order";
    },
    makeParams: (input: any, creds: any) => {
      if (!input.symbol) throw new Error("symbol is required for cancel_order");
      if (!input.order_id)
        throw new Error("order_id is required for cancel_order");

      const environment = input?.environment || "live";
      const assetType = input?.asset_type || "spot";
      const timestamp = getBinanceTimestamp(environment, assetType);
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
      const assetType = input?.asset_type || "spot";
      return assetType === "futures" ? "/fapi/v1/klines" : "/api/v3/klines";
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
      if (!Array.isArray(raw)) return { symbol: input.symbol, candles: [] };

      const candles = raw.map((kline: any) => ({
        t: kline[0],
        o: parseFloat(kline[1]),
        h: parseFloat(kline[2]),
        l: parseFloat(kline[3]),
        c: parseFloat(kline[4]),
        v: parseFloat(kline[5]),
      }));

      return { symbol: input.symbol, candles };
    },
  },
  get_latest_bar: {
    method: "get",
    path: (input: any) => {
      const assetType = input?.asset_type || "spot";
      return assetType === "futures"
        ? "/fapi/v1/ticker/24hr"
        : "/api/v3/ticker/24hr";
    },
    makeParams: (input: any) => {
      if (!input.symbol)
        throw new Error("symbol is required for get_latest_bar");
      return { symbol: input.symbol };
    },
    transformResult: (raw: any, input: any) => ({
      symbol: input.symbol,
      bar: [
        {
          t: raw.closeTime,
          o: parseFloat(raw.openPrice),
          h: parseFloat(raw.highPrice),
          l: parseFloat(raw.lowPrice),
          c: parseFloat(raw.lastPrice),
          v: parseFloat(raw.volume),
        },
      ],
    }),
  },
  get_ticker: {
    method: "get",
    path: (input: any) => {
      const assetType = input?.asset_type || "spot";
      return assetType === "futures"
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
      const assetType = input?.asset_type || "spot";
      return assetType === "futures" ? "/fapi/v1/order" : "/api/v3/order";
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
      const assetType = input?.asset_type || "spot";
      const timestamp = getBinanceTimestamp(environment, assetType);
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
    transformResult: (raw: any) => ({
      orderId: raw.orderId,
      symbol: raw.symbol,
      status: raw.status,
      executedQty: raw.executedQty,
      price: raw.price,
      side: raw.side,
    }),
  },
};
