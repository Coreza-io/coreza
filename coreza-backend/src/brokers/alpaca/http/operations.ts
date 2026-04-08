import { convertToISO8601 } from "../../../utils/dates";
import { BrokerOperation } from "../../types";
import { fromAlpacaBar, parseAlpacaRawBar } from "../helpers";

const KNOWN_CRYPTO_QUOTES = ["USD", "USDT", "USDC", "BTC"];

function toCanonicalCryptoSymbol(symbol: string): string {
  const fallbackSymbol = "ETH/USD";
  if (!symbol || typeof symbol !== "string") return fallbackSymbol;

  const upperSymbol = symbol.toUpperCase().replace(/\s+/g, "");
  if (upperSymbol.includes("/")) {
    const [base, quote] = upperSymbol.split("/");
    if (base && quote) return `${base}/${quote}`;
    return fallbackSymbol;
  }

  const quote = KNOWN_CRYPTO_QUOTES.find(
    (q) => upperSymbol.endsWith(q) && upperSymbol.length > q.length,
  );
  if (!quote) return fallbackSymbol;

  return `${upperSymbol.slice(0, -quote.length)}/${quote}`;
}

function normalizeCryptoSymbolsInPayload(payload: any): any {
  if (!payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload)) {
    return payload.map((item) => normalizeCryptoSymbolsInPayload(item));
  }

  return Object.entries(payload).reduce(
    (acc, [key, value]) => {
      if (key === "symbol" && typeof value === "string") {
        acc[key] = toCanonicalCryptoSymbol(value);
        return acc;
      }

      if (key === "symbols" && typeof value === "string") {
        acc[key] = value
          .split(",")
          .map((s) => toCanonicalCryptoSymbol(s))
          .join(",");
        return acc;
      }

      if (key === "symbols" && Array.isArray(value)) {
        acc[key] = value.map((v) =>
          typeof v === "string" ? toCanonicalCryptoSymbol(v) : v,
        );
        return acc;
      }

      acc[key] = normalizeCryptoSymbolsInPayload(value);
      return acc;
    },
    {} as Record<string, any>,
  );
}

export const alpacaOperations: Record<string, BrokerOperation> = {
  get_account: {
    method: "get",
    path: "/v2/account",
  },
  get_positions: {
    method: "get",
    path: "/v2/positions",
    transformResult: (raw: any, input: any) => {
      const result = {
        positions: raw,
      };
      return input.asset_type === "crypto"
        ? normalizeCryptoSymbolsInPayload(result)
        : result;
    },
  },
  get_orders: {
    method: "get",
    path: "/v2/orders",
    makeParams: (input: any) => ({
      status: input.status || "all",
      limit: "100",
    }),
    transformResult: (raw: any, input: any) => {
      const result = {
        orders: raw,
      };
      return input.asset_type === "crypto"
        ? normalizeCryptoSymbolsInPayload(result)
        : result;
    },
  },
  cancel_orders: {
    method: "delete",
    path: "/v2/orders",
  },
  get_candle: {
    method: "get",
    path: (input: any) =>
      input.asset_type === "crypto"
        ? "/v1beta3/crypto/us/bars"
        : "/v2/stocks/bars",
    makeParams: (input: any) => {
      if (!input.symbol)
        throw new Error("Symbol is required for get_candle operation");
      const params: Record<string, any> = {
        symbols: input.symbol,
        timeframe: input.interval,
        start: input.start,
        //adjustment: "raw",
        feed: input.feed,
        sort: input.sort,
        limit: Math.min(Number(input.limit) || 10000, 10000), // Max 10000 per request
      };
      if (input.end) params.end = input.end;
      if (input.page_token) params.page_token = input.page_token;
      return params;
    },
    pagination: {
      enabled: true,
      tokenField: "next_page_token",
      paramField: "page_token",
      dataField: "bars",
      mergeStrategy: "concat",
    },

    transformResult: (raw: any, input: any) => {
      const barsObj = raw?.bars ?? {};

      const BarSeries = Object.entries(barsObj).map(
        ([symbol, b]: [string, any]) => {
          const arr = Array.isArray(b) ? b : [b];

          const bars = arr
            .filter(Boolean)
            .map((x: any) => fromAlpacaBar(parseAlpacaRawBar(x)));

          return {
            symbol:
              input.asset_type === "crypto"
                ? toCanonicalCryptoSymbol(symbol)
                : symbol,
            interval: input.interval,
            bars,
          };
        },
      );

      return {
        BarSeries: BarSeries,
        next_page_token: raw.next_page_token || null,
        has_more: !!raw.next_page_token,
      };
    },
  },
  get_latest_bar: {
    method: "get",
    path: (input: any) =>
      input.asset_type === "crypto"
        ? "/v1beta3/crypto/us/latest/bars"
        : "/v2/stocks/bars/latest",
    makeParams: (input: any) => {
      if (!input.symbol)
        throw new Error("Symbol is required for get_latest_bar operation");
      const params: any = { symbols: input.symbol };
      if (input.asset_type !== "crypto" && input.feed) params.feed = input.feed;
      if (input.currency) params.currency = input.currency;
      return params;
    },
    transformResult: (raw: any, input: any) => {
      const barsObj = raw?.bars ?? {};

      const BarSeries = Object.entries(barsObj).map(
        ([symbol, b]: [string, any]) => {
          const arr = Array.isArray(b) ? b : [b];

          const bars = arr
            .filter(Boolean)
            .map((x: any) => fromAlpacaBar(parseAlpacaRawBar(x)));

          return {
            symbol:
              input.asset_type === "crypto"
                ? toCanonicalCryptoSymbol(symbol)
                : symbol,
            interval: input.interval || "1m",
            bars,
          };
        },
      );

      return {
        BarSeries,
      };
    },
  },
  fetch_news: {
    method: "get",
    path: "/v1beta1/news",
    makeParams: (input: any) => {
      const params: any = {};

      if (input.symbols) {
        const symbolArray =
          typeof input.symbols === "string"
            ? input.symbols
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean)
            : Array.isArray(input.symbols)
              ? input.symbols
              : [];
        if (symbolArray.length > 0) {
          params.symbols = symbolArray.join(",");
        }
      }

      if (input.start && input.start.trim() !== "") {
        params.start = convertToISO8601(input.start);
      }
      if (input.end && input.end.trim() !== "") {
        params.end = convertToISO8601(input.end);
      }

      if (input.limit && input.limit.toString().trim() !== "") {
        const limitNum = Number(input.limit);
        if (!isNaN(limitNum) && limitNum > 0) {
          params.limit = limitNum;
        }
      }

      if (input.sort && input.sort.trim() !== "") {
        params.sort = input.sort.trim();
      }

      if (input.page_token && input.page_token.trim() !== "") {
        params.page_token = input.page_token.trim();
      }

      if (input.include_content !== undefined && input.include_content !== "") {
        params.include_content =
          input.include_content === "true" || input.include_content === true;
      }

      return params;
    },
    transformResult: (data: any) => ({
      news: data.news || [],
      count: data.news?.length || 0,
      next_page_token: data.next_page_token || null,
    }),
  },
  place_order: {
    method: "post",
    path: "/v2/orders",
    makeBody: (input: any) => {
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
        extended_hours,
      } = input;

      if (!symbol) throw new Error("Symbol is required for place_order");
      if (!qty && !notional)
        throw new Error("Either qty or notional must be provided");

      const body: any = { symbol, side, type, time_in_force };

      if (type === "limit") {
        if (!limit_price) throw new Error("Limit orders require a limit_price");
        body.limit_price = String(limit_price);
      } else if (type === "stop") {
        if (!stop_price) throw new Error("Stop orders require a stop_price");
        body.stop_price = String(stop_price);
      } else if (type === "stop_limit") {
        if (!stop_price || !stop_limit_price) {
          throw new Error(
            "Stop limit orders require both stop_price and limit_price",
          );
        }
        body.stop_price = String(stop_price);
        body.limit_price = String(stop_limit_price);
      } else if (type === "trailing_stop") {
        if (!trail_percent && !trail_price) {
          throw new Error(
            "Either trail percent or trail price must be provided",
          );
        }
        if (trail_percent) body.trail_percent = String(trail_percent);
        else body.trail_price = String(trail_price);
      }

      if (notional) body.notional = String(notional);
      else body.qty = String(qty);

      if (extended_hours === "true" || extended_hours === true) {
        body.extended_hours = true;
      }

      if (input._idempotencyKey) {
        body.client_order_id = input._idempotencyKey;
      }

      return body;
    },
    transformResult: (raw: any, input: any) =>
      input.asset_type === "crypto"
        ? normalizeCryptoSymbolsInPayload(raw)
        : raw,
  },
  close_position: {
    method: "delete",
    path: (input: any) => {
      const normalized = input.symbol.replace("/", ""); // ETH/USD → ETHUSD
      return `/v2/positions/${normalized}`;
    },
    makeParams: (input: any) => {
      const params: any = {};
      if (input.qty) params.qty = String(input.qty);
      if (input.percentage) params.percentage = String(input.percentage);
      return params;
    },
    transformResult: (raw: any, input: any) =>
      input.asset_type === "crypto"
        ? normalizeCryptoSymbolsInPayload(raw)
        : raw,
  },
};
