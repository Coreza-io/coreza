// src/brokers/configs.ts
import { RestConfig } from "../RestBrokerService";
import { BrokerInput } from "../types";

export const alpacaConfig: RestConfig = {
  // 1. Dynamic baseUrl: trading vs market‑data
  baseUrl: (creds: any, input?: BrokerInput) => {
    // Market data operations always use data.alpaca.markets
    if (
      input?.operation === "get_candle" ||
      input?.operation === "get_latest_bar"
    ) {
      return "https://data.alpaca.markets";
    }

    // Trading operations check environment selection
    return input?.environment === "live"
      ? "https://api.alpaca.markets" // Production
      : "https://paper-api.alpaca.markets"; // Sandbox (default)
  },

  // 2. Auth headers remain the same
  makeAuthHeaders: (creds: any) => ({
    "APCA-API-KEY-ID": creds.api_key,
    "APCA-API-SECRET-KEY": creds.secret_key,
  }),

  // 3. Operation → HTTP mapping
  ops: {
    get_account: {
      method: "get",
      path: "/v2/account",
    },

    get_positions: {
      method: "get",
      path: "/v2/positions",
    },

    get_orders: {
      method: "get",
      path: "/v2/orders",
      makeParams: () => ({
        status: "all",
        limit: "100",
      }),
    },

    cancel_orders: {
      method: "delete",
      path: "/v2/orders",
    },

    get_candle: {
      method: "get",
      path: (input: BrokerInput) => {
        return input.asset_type === "crypto"
          ? "/v1beta3/crypto/us/bars"
          : "/v2/stocks/bars";
      },
      makeParams: (input: BrokerInput) => {
        const {
          symbol,
          interval,
          limit,
          start: inputStart,
          end: inputEnd,
          sort,
          feed,
        } = input;

        if (!symbol) {
          throw new Error("Symbol is required for get_candle operation");
        }

        // calculate start/end if needed
        let startDate = inputStart;
        let endDate = inputEnd;
        let timeframe = interval;

        const params: any = {
          symbols: symbol,
          timeframe,
          start: startDate,
          end: endDate,
          ...(limit ? { limit } : {}),
          adjustment: "raw",
          feed: feed,
          sort: sort,
        };

        return params;
      },
      transformResult: (raw: any, input: BrokerInput) => {
        // Normalize Alpaca bars response into Candle[]
        const arr = {
          symbol: input.symbol,
          candles: raw.bars?.[input.symbol] ?? [],
        };
        return arr;
      },
    },

    get_latest_bar: {
      method: "get",
      path: (input: BrokerInput) => {
        return input.asset_type === "crypto"
          ? "/v1beta3/crypto/us/latest/bars"
          : "/v2/stocks/bars/latest";
      },
      makeParams: (input: BrokerInput) => {
        const { symbol, feed, currency } = input;

        if (!symbol) {
          throw new Error("Symbol is required for get_latest_bar operation");
        }

        const params: any = {
          symbols: symbol, // Can be comma-separated list
        };

        // Add feed parameter for stocks (optional - defaults to sip/iex based on subscription)
        if (input.asset_type !== "crypto" && feed) {
          params.feed = feed;
        }

        // Add currency if specified (defaults to USD on API side)
        if (currency) {
          params.currency = currency;
        }

        return params;
      },
      transformResult: (raw: any, input: BrokerInput) => {
        // Normalize latest bar response
        return {
          symbol: input.symbol,
          bar: raw.bars?.[input.symbol] ? [raw.bars[input.symbol]] : [],
        };
      },
    },

    // inside src/brokers/configs.ts → alpacaConfig.ops:
    place_order: {
      method: "post",
      path: "/v2/orders",
      makeBody: (input: BrokerInput) => {
        const {
          symbol,
          qty,
          notional,
          side,
          type,
          time_in_force,
          limit_price,
          stop_price,
          stop_limit_price,
          trail_percent,
          trail_price,
        } = input;

        // Required base fields
        if (!symbol) {
          throw new Error("Symbol and side are required for place_order");
        }
        if (!qty && !notional) {
          throw new Error("Either qty or notional must be provided");
        }

        const body: any = {
          symbol,
          side,
          type, // market | limit | stop | stop_limit
          time_in_force, // day | gtc | fok | ioc
        };

        // Attach price fields based on order type
        if (type === "limit") {
          if (!limit_price) {
            throw new Error("Limit orders require a limit_price");
          }
          body.limit_price = String(limit_price);
        } else if (type === "stop") {
          if (!stop_price) {
            throw new Error("Stop orders require a stop_price");
          }
          body.stop_price = String(stop_price);
        } else if (type === "stop_limit") {
          if (!stop_price || !stop_limit_price) {
            throw new Error(
              "Stop limit orders require both stop_price and limit_price"
            );
          }
          body.stop_price = String(stop_price);
          body.limit_price = String(stop_limit_price);
        } else if (type === "trailing_stop") {
          if (!trail_percent && !trail_price) {
            throw new Error(
              "Either trail percent or trail price must be provided"
            );
          }

          if (trail_percent) {
            body.trail_percent = String(trail_percent);
          } else {
            body.trail_price = String(trail_price);
          }
        }
        // market orders need no extra price fields

        // Quantity vs Notional (both supported)
        if (notional) {
          body.notional = String(notional);
        } else {
          body.qty = String(qty);
        }

        return body;
      },
    },
  },
};
