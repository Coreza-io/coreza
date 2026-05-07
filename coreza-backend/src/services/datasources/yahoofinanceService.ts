/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import yahooFinance from "yahoo-finance2";
import type { Quote } from "yahoo-finance2/dist/esm/src/modules/quote";
import type { SearchResult } from "yahoo-finance2/dist/esm/src/modules/search";
import type { TrendingSymbolsResult } from "yahoo-finance2/dist/esm/src/modules/trendingSymbols";
import { DataSourceInput, DataSourceResult, IDataSourceService } from "./types";

type YahooInterval =
  | "1m"
  | "2m"
  | "5m"
  | "15m"
  | "30m"
  | "60m"
  | "90m"
  | "1h"
  | "1d"
  | "5d"
  | "1wk"
  | "1mo"
  | "3mo";

export class YahooFinanceDataSourceService implements IDataSourceService {
  readonly serviceKey = "yahoofinance";

  async execute(input: DataSourceInput): Promise<DataSourceResult> {
    try {
      let data: any;
      switch (input.operation) {
        case "get_quote":
          data = await this.getQuote(input);
          break;
        case "get_history":
          data = await this.getHistory(input);
          break;
        case "search":
          data = await this.search(input);
          break;
        case "get_summary":
          data = await this.getSummary();
          break;
        case "get_trending":
          data = await this.getTrending();
          break;
        default:
          return {
            success: false,
            error: `Unsupported Yahoo Finance operation: ${input.operation}`,
          };
      }

      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async getQuote(input: DataSourceInput): Promise<any> {
    const { symbol } = input;

    if (!symbol) {
      throw new Error("symbol is required");
    }

    const quote = (await yahooFinance.quote(symbol)) as unknown as Quote;

    return {
      symbol: quote.symbol ?? symbol,
      price: quote.regularMarketPrice ?? null,
      change: quote.regularMarketChange ?? null,
      changePercent: quote.regularMarketChangePercent ?? null,
      volume: quote.regularMarketVolume ?? null,
      marketCap: quote.marketCap ?? null,
      previousClose: quote.regularMarketPreviousClose ?? null,
      open: quote.regularMarketOpen ?? null,
      dayHigh: quote.regularMarketDayHigh ?? null,
      dayLow: quote.regularMarketDayLow ?? null,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow ?? null,
      timestamp: new Date().toISOString(),
    };
  }

  private resolveDate(value?: number | string, fallback?: Date): Date {
    if (typeof value === "number") {
      return new Date(value * 1000);
    }
    if (value) {
      return new Date(value);
    }
    return fallback ?? new Date();
  }

  private async getHistory(input: DataSourceInput): Promise<any> {
    const {
      symbol,
      period1,
      period2,
      interval = "1d",
      date_mode = "lookback",
      lookback = 100,
      start_date,
      end_date,
    } = input;

    if (!symbol) {
      throw new Error("symbol is required");
    }

    let startDate: Date;
    let endDate: Date;

    if (period1 || period2) {
      startDate = this.resolveDate(period1, new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));
      endDate = this.resolveDate(period2, new Date());
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

    console.log(`Fetching Yahoo Finance historical data for ${symbol}`, {
      period1: startDate.toISOString(),
      period2: endDate.toISOString(),
      interval,
      date_mode,
      lookback,
    });

    const chart = await yahooFinance.chart(symbol, {
      period1: startDate,
      period2: endDate,
      interval: interval as YahooInterval,
    });

    const history = chart.quotes || [];

    return history.map((item) => ({
      date: item.date,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume,
      adjClose: item.adjclose,
    }));
  }

  private async search(input: DataSourceInput): Promise<any> {
    const { query } = input;

    if (!query) {
      throw new Error("query is required");
    }

    const results = (await yahooFinance.search(query)) as SearchResult;

    return {
      query,
      results:
        results.quotes
          ?.map((quote) => {
            if (!quote || typeof quote !== "object") {
              return null;
            }
            const symbolValue = (quote as { symbol?: string }).symbol;
            if (!symbolValue) {
              return null;
            }
            const shortname = (quote as { shortname?: string }).shortname;
            const longname = (quote as { longname?: string }).longname;
            const exchange = (quote as { exchange?: string }).exchange;
            const quoteType = (quote as { quoteType?: string }).quoteType;

            return {
              symbol: symbolValue,
              shortname: shortname ?? null,
              longname: longname ?? null,
              exchange: exchange ?? null,
              type: quoteType ?? null,
            };
          })
          .filter((quote): quote is NonNullable<typeof quote> => quote !== null) || [],
    };
  }

  private async getSummary(): Promise<any> {
    const indices = ["^GSPC", "^DJI", "^IXIC", "^RUT"];
    const quotes = await Promise.all(
      indices.map(async (symbol) => {
        try {
          const quote = (await yahooFinance.quote(symbol)) as unknown as Quote;
          return {
            symbol: quote.symbol ?? symbol,
            name: quote.shortName ?? quote.longName ?? symbol,
            price: quote.regularMarketPrice ?? null,
            change: quote.regularMarketChange ?? null,
            changePercent: quote.regularMarketChangePercent ?? null,
          };
        } catch {
          return null;
        }
      })
    );

    return {
      timestamp: new Date().toISOString(),
      indices: quotes.filter(Boolean),
    };
  }

  private async getTrending(): Promise<any> {
    const trending = (await yahooFinance.trendingSymbols("US")) as TrendingSymbolsResult;

    const enriched = await Promise.all(
      (trending.quotes || []).map(async (quoteInfo) => {
        try {
          const quote = (await yahooFinance.quote(
            quoteInfo.symbol
          )) as unknown as Quote;
          return {
            symbol: quote.symbol ?? quoteInfo.symbol,
            name: quote.shortName ?? quote.longName ?? quoteInfo.symbol,
            price: quote.regularMarketPrice ?? null,
            change: quote.regularMarketChange ?? null,
            changePercent: quote.regularMarketChangePercent ?? null,
          };
        } catch {
          return {
            symbol: quoteInfo.symbol,
            name: quoteInfo.symbol,
            price: null,
            change: null,
            changePercent: null,
          };
        }
      })
    );

    return {
      region: "US",
      trending: enriched,
    };
  }
}
