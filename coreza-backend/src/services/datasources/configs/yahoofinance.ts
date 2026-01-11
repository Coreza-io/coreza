/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import axios from "axios";
import { DataSourceConfig } from "../dataSource";
import { DataSourceInput } from "../types";

const YAHOO_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const cleanParams = (params: Record<string, any>): Record<string, any> => {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== "" && value !== null
    )
  );
};

const toUnixSeconds = (value?: string | number): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return Math.floor(value);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return Math.floor(parsed.getTime() / 1000);
};

const resolveDate = (value?: number | string, fallback?: Date): Date => {
  if (typeof value === "number") {
    return new Date(value * 1000);
  }
  if (value) {
    return new Date(value);
  }
  return fallback ?? new Date();
};

const resolveHistoryRange = (input: DataSourceInput) => {
  const {
    period1,
    period2,
    interval = "1d",
    date_mode = "lookback",
    lookback = 100,
    start_date,
    end_date,
  } = input;

  let startDate: Date;
  let endDate: Date;

  if (period1 || period2) {
    startDate = resolveDate(
      period1,
      new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    );
    endDate = resolveDate(period2, new Date());
  } else if (date_mode === "range") {
    if (!start_date) {
      throw new Error("start_date is required for range mode");
    }
    startDate = new Date(start_date);
    endDate = end_date ? new Date(end_date) : new Date();
  } else {
    endDate = new Date();
    startDate = new Date();
    const lookbackNum = Number(lookback) || 100;

    switch (interval) {
      case "1m":
        startDate.setMinutes(endDate.getMinutes() - lookbackNum);
        break;
      case "5m":
        startDate.setMinutes(endDate.getMinutes() - lookbackNum * 5);
        break;
      case "15m":
        startDate.setMinutes(endDate.getMinutes() - lookbackNum * 15);
        break;
      case "60m":
      case "1h":
        startDate.setHours(endDate.getHours() - lookbackNum);
        break;
      case "1d":
      default:
        startDate.setDate(endDate.getDate() - lookbackNum);
        break;
    }
  }

  return {
    period1: Math.floor(startDate.getTime() / 1000),
    period2: Math.floor(endDate.getTime() / 1000),
  };
};

const resolveSymbol = (input: DataSourceInput) => {
  const symbol = input.symbol?.toUpperCase() || input.ticker?.toUpperCase();
  if (!symbol) {
    throw new Error("symbol is required");
  }
  return symbol;
};

export const yahoofinanceDataSourceConfig: DataSourceConfig = {
  authType: "none",
  baseUrl: (_creds, input) => {
    const op = input?.operation;
    if (op === "search" || op === "get_trending") {
      return "https://query2.finance.yahoo.com";
    }
    return "https://query1.finance.yahoo.com";
  },

  makeAuthHeaders: () => ({
    "User-Agent": YAHOO_USER_AGENT,
    Accept: "application/json",
  }),

  validateCredentials: async () => {
    try {
      const response = await axios.get(
        "https://query1.finance.yahoo.com/v7/finance/quote",
        {
          params: { symbols: "AAPL" },
          headers: {
            "User-Agent": YAHOO_USER_AGENT,
            Accept: "application/json",
          },
          timeout: 10000,
        }
      );
      if (response.data?.quoteResponse?.result?.length) {
        return { valid: true };
      }
      return { valid: false, error: "Invalid API response" };
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        return { valid: false, error: "Yahoo Finance request blocked" };
      }
      return { valid: false, error: error.message || "Validation failed" };
    }
  },

  ops: {
    get_quote: {
      method: "get",
      path: "/v7/finance/quote",
      requiresCredentials: false,
      makeParams: (input: DataSourceInput) =>
        cleanParams({
          symbols: resolveSymbol(input),
        }),
      transformResult: (data: any, input: DataSourceInput) => {
        const result = data?.quoteResponse?.result?.[0];
        const fallbackSymbol =
          input.symbol?.toUpperCase() || input.ticker?.toUpperCase();

        return {
          symbol: result?.symbol ?? fallbackSymbol,
          price: result?.regularMarketPrice ?? null,
          change: result?.regularMarketChange ?? null,
          changePercent: result?.regularMarketChangePercent ?? null,
          volume: result?.regularMarketVolume ?? null,
          marketCap: result?.marketCap ?? null,
          previousClose: result?.regularMarketPreviousClose ?? null,
          open: result?.regularMarketOpen ?? null,
          dayHigh: result?.regularMarketDayHigh ?? null,
          dayLow: result?.regularMarketDayLow ?? null,
          fiftyTwoWeekHigh: result?.fiftyTwoWeekHigh ?? null,
          fiftyTwoWeekLow: result?.fiftyTwoWeekLow ?? null,
          timestamp: new Date().toISOString(),
        };
      },
    },

    get_history: {
      method: "get",
      path: (input: DataSourceInput) =>
        `/v8/finance/chart/${resolveSymbol(input)}`,
      requiresCredentials: false,
      makeParams: (input: DataSourceInput) => {
        const { period1, period2 } = resolveHistoryRange(input);
        return cleanParams({
          period1: toUnixSeconds(period1) ?? period1,
          period2: toUnixSeconds(period2) ?? period2,
          interval: input.interval || "1d",
        });
      },
      transformResult: (data: any) => {
        const result = data?.chart?.result?.[0];
        if (!result) {
          return [];
        }

        const timestamps: number[] = result.timestamp || [];
        const quote = result.indicators?.quote?.[0] || {};
        const adjClose = result.indicators?.adjclose?.[0]?.adjclose || [];

        return timestamps.map((timestamp, index) => ({
          date: new Date(timestamp * 1000),
          open: quote.open?.[index] ?? null,
          high: quote.high?.[index] ?? null,
          low: quote.low?.[index] ?? null,
          close: quote.close?.[index] ?? null,
          volume: quote.volume?.[index] ?? null,
          adjClose: adjClose?.[index] ?? null,
        }));
      },
    },

    search: {
      method: "get",
      path: "/v1/finance/search",
      requiresCredentials: false,
      makeParams: (input: DataSourceInput) =>
        cleanParams({
          q: input.query,
          quotesCount: input.limit || 10,
          newsCount: 0,
        }),
      transformResult: (data: any, input: DataSourceInput) => ({
        query: input.query,
        results:
          data?.quotes
            ?.map((quote: any) => {
              if (!quote?.symbol) {
                return null;
              }
              return {
                symbol: quote.symbol,
                shortname: quote.shortname ?? null,
                longname: quote.longname ?? null,
                exchange: quote.exchange ?? null,
                type: quote.quoteType ?? null,
              };
            })
            .filter(Boolean) || [],
      }),
    },

    get_summary: {
      method: "get",
      path: "/v7/finance/quote",
      requiresCredentials: false,
      makeParams: () =>
        cleanParams({
          symbols: "^GSPC,^DJI,^IXIC,^RUT",
        }),
      transformResult: (data: any) => {
        const results = data?.quoteResponse?.result || [];
        return {
          timestamp: new Date().toISOString(),
          indices: results.map((quote: any) => ({
            symbol: quote.symbol ?? null,
            name: quote.shortName ?? quote.longName ?? quote.symbol ?? null,
            price: quote.regularMarketPrice ?? null,
            change: quote.regularMarketChange ?? null,
            changePercent: quote.regularMarketChangePercent ?? null,
          })),
        };
      },
    },

    get_trending: {
      method: "get",
      path: "/v1/finance/trending/US",
      requiresCredentials: false,
      transformResult: (data: any) => {
        const results = data?.finance?.result?.[0]?.quotes || [];

        return {
          region: "US",
          trending: results.map((quote: any) => ({
            symbol: quote.symbol ?? null,
            name: quote.shortName ?? quote.longName ?? quote.symbol ?? null,
            price: quote.regularMarketPrice ?? null,
            change: quote.regularMarketChange ?? null,
            changePercent: quote.regularMarketChangePercent ?? null,
          })),
        };
      },
    },
  },
};
