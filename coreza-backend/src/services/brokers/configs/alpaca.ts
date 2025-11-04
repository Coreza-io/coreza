// src/brokers/configs.ts
import { RestConfig } from "../RestBrokerService";
import { BrokerInput } from "../types";

export const alpacaConfig: RestConfig = {
  // 1. Dynamic baseUrl: trading vs market‑data
  baseUrl: (creds: any, input?: BrokerInput) => {
    if (input?.operation === "get_candle") {
      return input?.asset_type === "crypto"
        ? "https://data.alpaca.markets"
        : "https://data.alpaca.markets";
    }
    return creds.paper_trading
      ? "https://paper-api.alpaca.markets"
      : //: 'https://api.alpaca.markets';
        "https://paper-api.alpaca.markets";
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
          lookback,
          start: inputStart,
          end: inputEnd,
        } = input;

        if (!symbol) {
          throw new Error("Symbol is required for get_candle operation");
        }

        // parse lookback/limit
        const lb = Number(lookback) || 1000;

        // calculate start/end if needed
        let startDate = inputStart;
        let endDate = inputEnd;
        let timeframe = interval;

        const params: any = {
          symbols: symbol,
          timeframe,
          start: startDate,
          end: endDate,
          limit: String(lb),
          adjustment: "raw",
          sort: "asc"
        };

        // Use SIP feed for stocks (premium data)
        if (input.asset_type !== "crypto") {
          params.feed = "sip";
        }

        return params;
      },
      
      // Enable pagination for multi-symbol requests
      pagination: {
        pageParam: "page_token",
        nextTokenPath: "next_page_token",
        maxPages: 100,
        
        /**
         * Merge strategy: Combine bars from all pages by symbol
         * Alpaca returns: { bars: { AAPL: [...], AMZN: [...] }, next_page_token: "..." }
         */
        mergePages: (accumulated: any, newPage: any, input: BrokerInput) => {
          if (!accumulated.bars) {
            accumulated.bars = {};
          }
          
          // Merge bars from newPage into accumulated
          if (newPage.bars) {
            for (const symbol in newPage.bars) {
              if (!accumulated.bars[symbol]) {
                accumulated.bars[symbol] = [];
              }
              // Append new candles to existing symbol data
              accumulated.bars[symbol].push(...newPage.bars[symbol]);
            }
          }
          
          // Update metadata (keep latest)
          if (newPage.next_page_token) {
            accumulated.next_page_token = newPage.next_page_token;
          } else {
            delete accumulated.next_page_token;
          }
          
          return accumulated;
        }
      },
      
      transformResult: (raw: any, input: BrokerInput) => {
        // When multiple symbols, return all symbols' candles
        if (input.symbol?.includes(',')) {
          const symbols = input.symbol.split(',').map((s: string) => s.trim());
          const result: any = {};
          
          for (const sym of symbols) {
            result[sym] = raw.bars?.[sym] ?? [];
          }
          
          return {
            symbols: input.symbol,
            data: result,
            total_bars: Object.values(result).reduce((sum: number, candles: any) => sum + candles.length, 0)
          };
        } else {
          // Single symbol - maintain backward compatibility
          return {
            symbol: input.symbol,
            candles: raw.bars?.[input.symbol] ?? [],
          };
        }
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
