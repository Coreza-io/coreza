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

const ALGO_TYPES = new Set([
  "STOP",
  "TAKE_PROFIT",
  "STOP_MARKET",
  "TAKE_PROFIT_MARKET",
  "TRAILING_STOP_MARKET",
]);
const STANDARD_FUTURES_TYPES = new Set(["LIMIT", "MARKET"]);

function normalizePriceMatch(value: any) {
  if (!value || value === "NONE") return undefined;
  return value;
}

function isAlgoCancel(input: any): boolean {
  return Boolean(
    String(input?.algoId ?? "").trim() ||
    String(input?.clientAlgoId ?? "").trim(),
  );
}

function assertNoConflictingFields(input: any) {
  if (input.closePosition === true && input.quantity) {
    throw new Error("quantity cannot be sent when closePosition=true");
  }

  if (input.closePosition === true && input.reduceOnly === true) {
    throw new Error("reduceOnly cannot be sent when closePosition=true");
  }

  if (input.price && input.priceMatch && input.priceMatch !== "NONE") {
    throw new Error("price cannot be sent together with priceMatch");
  }
}

function resolveGoodTillDateTimestamp(rawValue: any) {
  if (!rawValue) return null;
  const parsed = new Date(rawValue).getTime();
  if (Number.isNaN(parsed)) {
    throw new Error("goodTillDate must be a valid datetime");
  }
  return parsed;
}

function validateGoodTillDate(input: any, timeInForceValue: string) {
  if (timeInForceValue !== "GTD") {
    if (input.goodTillDate) {
      throw new Error("goodTillDate is only supported when timeInForce=GTD");
    }
    return null;
  }

  const goodTillDate = resolveGoodTillDateTimestamp(input.goodTillDate);
  if (!goodTillDate) {
    throw new Error("goodTillDate is required when timeInForce=GTD");
  }
  const now = Date.now();
  if (goodTillDate <= now + 600_000) {
    throw new Error("goodTillDate must be at least 600 seconds in the future");
  }
  return goodTillDate;
}

function buildStandardFuturesPayload(
  input: any,
  baseParams: Record<string, any>,
) {
  assertNoConflictingFields(input);

  const params: Record<string, any> = { ...baseParams };
  const orderType = String(input.type).toUpperCase();
  const priceMatch = normalizePriceMatch(input.priceMatch);

  if (!STANDARD_FUTURES_TYPES.has(orderType)) {
    throw new Error(`Unsupported futures standard order type: ${orderType}`);
  }

  if (input.closePosition === true) {
    throw new Error(
      "closePosition is only supported for STOP_MARKET/TAKE_PROFIT_MARKET",
    );
  }

  if (!input.quantity) {
    throw new Error("quantity is required for place_order");
  }
  params.quantity = String(input.quantity);

  if (orderType === "LIMIT") {
    const tif = input.timeInForce || "GTC";
    params.timeInForce = tif;
    const goodTillDate = validateGoodTillDate(input, tif);
    if (goodTillDate) params.goodTillDate = goodTillDate;
    const hasPrice = Boolean(input.price);
    if (!hasPrice && !priceMatch) {
      throw new Error("price or priceMatch is required for this order type");
    }
    if (hasPrice) params.price = String(input.price);
    if (priceMatch) params.priceMatch = priceMatch;
  } else {
    if (input.price)
      throw new Error("price is not supported for MARKET orders");
    if (priceMatch)
      throw new Error("priceMatch is not supported for MARKET orders");
    if (input.timeInForce)
      throw new Error("timeInForce is not supported for MARKET orders");
    if (input.goodTillDate) {
      throw new Error("goodTillDate is only supported when timeInForce=GTD");
    }
  }

  if (input.positionSide) params.positionSide = input.positionSide;
  if (input.reduceOnly !== undefined) params.reduceOnly = input.reduceOnly;
  if (input.selfTradePreventionMode)
    params.selfTradePreventionMode = input.selfTradePreventionMode;

  if (input._idempotencyKey) params.newClientOrderId = input._idempotencyKey;
  return params;
}

function buildAlgoFuturesPayload(input: any, baseParams: Record<string, any>) {
  assertNoConflictingFields(input);

  const params: Record<string, any> = {
    ...baseParams,
    algoType: "CONDITIONAL",
  };
  const orderType = String(input.type).toUpperCase();
  const priceMatch = normalizePriceMatch(input.priceMatch);

  if (!ALGO_TYPES.has(orderType)) {
    throw new Error(`Unsupported futures algo order type: ${orderType}`);
  }

  if (input.positionSide) params.positionSide = input.positionSide;
  if (input.workingType) params.workingType = input.workingType;
  if (input.reduceOnly !== undefined) params.reduceOnly = input.reduceOnly;
  if (input.selfTradePreventionMode) {
    params.selfTradePreventionMode = input.selfTradePreventionMode;
  }

  if (
    ["STOP", "TAKE_PROFIT", "STOP_MARKET", "TAKE_PROFIT_MARKET"].includes(
      orderType,
    )
  ) {
    if (!input.stopPrice) {
      throw new Error("stopPrice is required for this order type");
    }
    params.triggerPrice = String(input.stopPrice);
  }

  if (orderType === "STOP" || orderType === "TAKE_PROFIT") {
    if (input.closePosition === true) {
      throw new Error(
        "closePosition is only supported for STOP_MARKET/TAKE_PROFIT_MARKET",
      );
    }
    if (!input.quantity)
      throw new Error("quantity is required for this order type");
    params.quantity = String(input.quantity);

    const hasPrice = Boolean(input.price);
    if (hasPrice === Boolean(priceMatch)) {
      throw new Error(
        "Exactly one of price or priceMatch is required for this order type",
      );
    }
    if (hasPrice) params.price = String(input.price);
    if (priceMatch) params.priceMatch = priceMatch;

    const tif = input.timeInForce || "GTC";
    params.timeInForce = tif;
    const goodTillDate = validateGoodTillDate(input, tif);
    if (goodTillDate) params.goodTillDate = goodTillDate;
    if (input.priceProtect !== undefined) {
      throw new Error(
        "priceProtect is only supported for STOP_MARKET/TAKE_PROFIT_MARKET",
      );
    }
  }

  if (orderType === "STOP_MARKET" || orderType === "TAKE_PROFIT_MARKET") {
    if (input.price || priceMatch) {
      throw new Error(
        "price and priceMatch are not supported for this order type",
      );
    }
    if (input.timeInForce) {
      throw new Error("timeInForce is not supported for this order type");
    }
    if (input.goodTillDate) {
      throw new Error("goodTillDate is not supported for this order type");
    }
    const hasQuantity = Boolean(input.quantity);
    const isClosePosition = input.closePosition === true;
    if (hasQuantity === isClosePosition) {
      throw new Error(
        "Exactly one of quantity or closePosition=true is required for this order type",
      );
    }
    if (hasQuantity) params.quantity = String(input.quantity);
    if (isClosePosition) params.closePosition = true;
    if (input.priceProtect !== undefined)
      params.priceProtect = input.priceProtect;
  }

  if (orderType === "TRAILING_STOP_MARKET") {
    if (input.closePosition === true) {
      throw new Error(
        "closePosition is not supported for TRAILING_STOP_MARKET",
      );
    }
    if (!input.callbackRate) {
      throw new Error("callbackRate is required for TRAILING_STOP_MARKET");
    }
    if (input.stopPrice) {
      throw new Error("stopPrice is not supported for TRAILING_STOP_MARKET");
    }
    if (input.price || priceMatch) {
      throw new Error(
        "price and priceMatch are not supported for TRAILING_STOP_MARKET",
      );
    }
    if (input.timeInForce || input.goodTillDate) {
      throw new Error(
        "timeInForce and goodTillDate are not supported for TRAILING_STOP_MARKET",
      );
    }
    if (input.priceProtect !== undefined) {
      throw new Error(
        "priceProtect is only supported for STOP_MARKET/TAKE_PROFIT_MARKET",
      );
    }
    params.callbackRate = String(input.callbackRate);
    if (input.activationPrice)
      params.activatePrice = String(input.activationPrice);
    if (input.quantity) params.quantity = String(input.quantity);
  }

  if (input.clientAlgoId) {
    params.clientAlgoId = input.clientAlgoId;
  } else if (input._idempotencyKey) {
    params.clientAlgoId = input._idempotencyKey;
  }

  return params;
}

export const binanceOperations: Record<string, BrokerOperation> = {
  start_user_data_stream: {
    method: "post",
    path: (input: any) => {
      const marketType = getMarketType(input);
      if (marketType !== "futures") {
        throw new Error(
          "start_user_data_stream is only supported for futures accounts",
        );
      }
      return "/fapi/v1/listenKey";
    },
  },
  keepalive_user_data_stream: {
    method: "put",
    path: (input: any) => {
      const marketType = getMarketType(input);
      if (marketType !== "futures") {
        throw new Error(
          "keepalive_user_data_stream is only supported for futures accounts",
        );
      }
      return "/fapi/v1/listenKey";
    },
  },
  close_user_data_stream: {
    method: "delete",
    path: (input: any) => {
      const marketType = getMarketType(input);
      if (marketType !== "futures") {
        throw new Error(
          "close_user_data_stream is only supported for futures accounts",
        );
      }
      return "/fapi/v1/listenKey";
    },
  },
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
      return marketType === "futures"
        ? "/fapi/v1/allOrders"
        : "/api/v3/allOrders";
    },
    makeParams: (input: any, creds: any) => {
      if (!input.symbol) throw new Error("symbol is required for get_orders");

      const params: Record<string, any> = {
        symbol: input.symbol,
        recvWindow: 60000,
        timestamp: getBinanceTimestamp(
          getEnvironment(input),
          getMarketType(input),
        ),
      };

      if (input.limit) params.limit = input.limit;
      if (input.startTime)
        params.startTime = new Date(input.startTime).getTime();
      if (input.endTime) params.endTime = new Date(input.endTime).getTime();

      return signParams(creds, params);
    },
    transformResult: (raw: any) => ({
      orders: raw,
    }),
  },
  get_order_by_client_id: {
    method: "get",
    path: (input: any) => getMarketType(input) === "futures"
      ? "/fapi/v1/order"
      : "/api/v3/order",
    makeParams: (input: any, creds: any) => signParams(creds, {
      symbol: input.symbol,
      origClientOrderId: input.client_order_id,
      recvWindow: 60000,
      timestamp: getBinanceTimestamp(getEnvironment(input), getMarketType(input)),
    }),
  },
  get_algo_order_by_client_id: {
    method: "get",
    path: () => "/fapi/v1/algoOrder",
    makeParams: (input: any, creds: any) => {
      if (getMarketType(input) !== "futures") {
        throw new Error("get_algo_order_by_client_id is only supported for futures accounts");
      }
      return signParams(creds, {
        symbol: input.symbol,
        clientAlgoId: input.client_order_id,
        recvWindow: 60000,
        timestamp: getBinanceTimestamp(getEnvironment(input), "futures"),
      });
    },
    execute: async ({ input, creds, baseUrl, headers, request }) => {
      const makeSignedParams = (extra: Record<string, unknown>) => signParams(creds, {
        ...extra,
        recvWindow: 60000,
        timestamp: getBinanceTimestamp(getEnvironment(input), "futures"),
      });
      try {
        const response = await request.get(`${baseUrl}/fapi/v1/algoOrder`, {
          headers,
          params: makeSignedParams({ symbol: input.symbol, clientAlgoId: input.client_order_id }),
          timeout: 30_000,
        });
        return response.data;
      } catch (error: unknown) {
        const status = error && typeof error === "object" && "response" in error &&
          error.response && typeof error.response === "object" && "status" in error.response
          ? error.response.status
          : undefined;
        if (typeof status !== "number" || ![400, 404, 405].includes(status)) throw error;
        const response = await request.get(`${baseUrl}/fapi/v1/allAlgoOrders`, {
          headers,
          params: makeSignedParams({ symbol: input.symbol }),
          timeout: 30_000,
        });
        const orders: unknown[] = Array.isArray(response.data)
          ? response.data
          : Array.isArray(response.data?.orders) ? response.data.orders : [];
        const found = orders.find((order) => order !== null && typeof order === "object" &&
          "clientAlgoId" in order && order.clientAlgoId === input.client_order_id);
        if (!found) {
          const notFound = new Error("Algo order not found") as Error & { response?: { status: number } };
          notFound.response = { status: 404 };
          throw notFound;
        }
        return found;
      }
    },
  },
  get_open_algo_orders: {
    method: "get",
    path: () => "/fapi/v1/openAlgoOrders",
    makeParams: (input: any, creds: any) => {
      const marketType = getMarketType(input);
      if (marketType !== "futures") {
        throw new Error(
          "get_open_algo_orders is only supported for futures accounts",
        );
      }
      const params: Record<string, any> = {
        recvWindow: 60000,
        timestamp: getBinanceTimestamp(getEnvironment(input), marketType),
      };
      if (input.symbol) params.symbol = input.symbol;
      if (input.algoType) params.algoType = input.algoType;
      return signParams(creds, params);
    },
  },
  get_all_algo_orders: {
    method: "get",
    path: () => "/fapi/v1/allAlgoOrders",
    makeParams: (input: any, creds: any) => {
      const marketType = getMarketType(input);
      if (marketType !== "futures") {
        throw new Error(
          "get_all_algo_orders is only supported for futures accounts",
        );
      }
      if (!input.symbol)
        throw new Error("symbol is required for get_all_algo_orders");
      const params: Record<string, any> = {
        symbol: input.symbol,
        recvWindow: 60000,
        timestamp: getBinanceTimestamp(getEnvironment(input), marketType),
      };
      if (input.algoType) params.algoType = input.algoType;
      if (input.startTime)
        params.startTime = new Date(input.startTime).getTime();
      if (input.endTime) params.endTime = new Date(input.endTime).getTime();
      if (input.limit) params.limit = input.limit;
      return signParams(creds, params);
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
      if (!input.symbol) throw new Error("symbol is required for get_trades");

      const params: Record<string, any> = {
        symbol: input.symbol,
        recvWindow: 60000,
        timestamp: getBinanceTimestamp(
          getEnvironment(input),
          getMarketType(input),
        ),
      };

      if (input.orderId) params.orderId = input.orderId;
      if (input.startTime)
        params.startTime = new Date(input.startTime).getTime();
      if (input.endTime) params.endTime = new Date(input.endTime).getTime();
      if (input.fromId) params.fromId = input.fromId;
      if (input.limit) params.limit = input.limit;

      return signParams(creds, params);
    },
    transformResult: (raw: any) => ({
      trades: raw,
    }),
  },
  // Real normal order exists
  // DELETE /fapi/v1/order
  // required: symbol + timestamp + signature
  // identity: orderId OR origClientOrderId
  //
  // Algo order still pending trigger
  // DELETE /fapi/v1/algoOrder
  // required: timestamp + signature
  // identity: algoId OR clientAlgoId
  cancel_order: {
    method: "delete",
    path: (input: any) => {
      const marketType = getMarketType(input);
      if (marketType === "futures") {
        return isAlgoCancel(input) ? "/fapi/v1/algoOrder" : "/fapi/v1/order";
      }
      // Spot only supports normal cancel
      return "/api/v3/order";
    },
    makeParams: (input: any, creds: any) => {
      const marketType = getMarketType(input);
      const algo = marketType === "futures" && isAlgoCancel(input);

      const params: Record<string, any> = {
        recvWindow: 60000,
        timestamp: getBinanceTimestamp(getEnvironment(input), marketType),
      };

      // symbol: required for normal cancel, optional/ignored for algo cancel
      if (!algo) {
        if (!input.symbol)
          throw new Error("symbol is required for cancel_order");
        params.symbol = input.symbol;
      } else if (input.symbol) {
        params.symbol = input.symbol;
      }
      const algoId = String(input?.algoId ?? input?.algo_id ?? "").trim();
      const clientAlgoId = String(
        input?.clientAlgoId ?? input?.client_algo_id ?? "",
      ).trim();
      const orderId = String(input?.orderId ?? input?.order_id ?? "").trim();
      const origClientOrderId = String(
        input?.origClientOrderId ?? input?.orig_client_order_id ?? "",
      ).trim();

      if (algo) {
        if (algoId) params.algoId = algoId;
        if (clientAlgoId) params.clientAlgoId = clientAlgoId;
        if (!params.algoId && !params.clientAlgoId) {
          throw new Error(
            "algoId or clientAlgoId is required for algo cancel_order",
          );
        }
      } else {
        if (orderId) params.orderId = orderId;
        if (origClientOrderId) params.origClientOrderId = origClientOrderId;
        if (!params.orderId && !params.origClientOrderId) {
          throw new Error(
            "orderId or origClientOrderId is required for cancel_order",
          );
        }
      }

      return signParams(creds, params);
    },
  },
  // get_open_algo_orders: {
  //   method: "get",
  //   path: () => "/fapi/v1/openAlgoOrders",
  //   makeParams: (input: any, creds: any) => {
  //     const marketType = getMarketType(input);
  //     if (marketType !== "futures") {
  //       throw new Error("get_open_algo_orders is only supported for futures accounts");
  //     }
  //     const params: Record<string, any> = {
  //       recvWindow: 60000,
  //       timestamp: getBinanceTimestamp(getEnvironment(input), marketType),
  //     };
  //     if (input.symbol) params.symbol = input.symbol;
  //     return signParams(creds, params);
  //   },
  //   transformResult: (raw: any) => ({ algoOrders: raw }),
  // },
  // get_all_algo_orders: {
  //   method: "get",
  //   path: () => "/fapi/v1/allAlgoOrders",
  //   makeParams: (input: any, creds: any) => {
  //     const marketType = getMarketType(input);
  //     if (marketType !== "futures") {
  //       throw new Error("get_all_algo_orders is only supported for futures accounts");
  //     }
  //     const params: Record<string, any> = {
  //       recvWindow: 60000,
  //       timestamp: getBinanceTimestamp(getEnvironment(input), marketType),
  //     };
  //     if (input.symbol) params.symbol = input.symbol;
  //     if (input.startTime) params.startTime = new Date(input.startTime).getTime();
  //     if (input.endTime) params.endTime = new Date(input.endTime).getTime();
  //     if (input.limit) params.limit = input.limit;
  //     return signParams(creds, params);
  //   },
  //   transformResult: (raw: any) => ({ algoOrders: raw }),
  // },
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
      if (marketType === "futures") {
        const orderType = String(input?.type || "").toUpperCase();
        return ALGO_TYPES.has(orderType)
          ? "/fapi/v1/algoOrder"
          : "/fapi/v1/order";
      }
      return "/api/v3/order";
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

      const marketType = getMarketType(input);
      const orderType = String(type).toUpperCase();

      const baseParams: Record<string, any> = {
        symbol: symbol.toUpperCase(),
        side: side.toUpperCase(),
        type: orderType,
        recvWindow: 60000,
        timestamp: getBinanceTimestamp(getEnvironment(input), marketType),
        newOrderRespType: newOrderRespType || "ACK",
      };

      if (marketType === "futures") {
        const params = ALGO_TYPES.has(orderType)
          ? buildAlgoFuturesPayload(input, baseParams)
          : buildStandardFuturesPayload(input, baseParams);
        return signParams(creds, params);
      }

      if (!quantity) throw new Error("quantity is required for place_order");

      const params: Record<string, any> = {
        ...baseParams,
        quantity: String(quantity),
      };

      const spotLimitLikeTypes = [
        "LIMIT",
        "STOP_LOSS_LIMIT",
        "TAKE_PROFIT_LIMIT",
      ];
      const limitLikeTypes = spotLimitLikeTypes;

      if (limitLikeTypes.includes(orderType)) {
        params.timeInForce = timeInForce || "GTC";
      }

      const needsPrice = [
        "LIMIT",
        "STOP_LOSS_LIMIT",
        "TAKE_PROFIT_LIMIT",
      ].includes(orderType);
      if (needsPrice) {
        if (!price) throw new Error("price is required for this order type");
        params.price = String(price);
      }

      const needsStopPrice = [
        "STOP_LOSS",
        "STOP_LOSS_LIMIT",
        "TAKE_PROFIT",
        "TAKE_PROFIT_LIMIT",
      ].includes(orderType);
      if (needsStopPrice) {
        if (!stopPrice)
          throw new Error("stopPrice is required for this order type");
        params.stopPrice = String(stopPrice);
      }

      if (icebergQty) params.icebergQty = String(icebergQty);

      if (input._idempotencyKey)
        params.newClientOrderId = input._idempotencyKey;

      return signParams(creds, params);
    },
  },
};
