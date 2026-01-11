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
import yahooFinance from "yahoo-finance2";
import type { Quote } from "yahoo-finance2/dist/esm/src/modules/quote";
import type { SearchResult } from "yahoo-finance2/dist/esm/src/modules/search";
import type { TrendingSymbolsResult } from "yahoo-finance2/dist/esm/src/modules/trendingSymbols";
import { createError } from "../middleware/errorHandler";
import CredentialManager from "../utils/credentialManager";
import {
  createSuccessOutput,
  createErrorOutput,
} from "../utils/normalizeOutput";
import type { StandardNodeOutput } from "../types/nodeOutput";
import { supabase } from "../config/supabase";

export interface DataInput {
  user_id?: string;
  credential_id?: string;
  [key: string]: any;
}

export interface DataResult {
  success: boolean;
  data?: any;
  error?: string;
}

// Base data service class
abstract class BaseDataService {
  protected abstract serviceName: string;

  protected async getCredentials(
    userId: string,
    credentialId: string
  ): Promise<any> {
    const { credentials } = await CredentialManager.getCredentials(
      userId,
      this.serviceName,
      credentialId
    );

    if (!credentials) {
      throw createError(`${this.serviceName} credentials not found`, 404);
    }

    // Merge client_json and token_json into a flat object for backward compatibility
    return {
      ...credentials.client_json,
      ...credentials.token_json,
    };
  }

  abstract execute(
    operation: string,
    input: DataInput
  ): Promise<StandardNodeOutput>;
}

// FinnHub service
class FinnHubService extends BaseDataService {
  protected serviceName = "finnhub";
  private baseUrl = "https://finnhub.io/api/v1";

  async execute(
    operation: string,
    input: DataInput
  ): Promise<StandardNodeOutput> {
    const context = { nodeName: "FinnHub", category: "data" };
    try {
      const { user_id, credential_id } = input;

      if (!user_id || !credential_id) {
        throw createError("user_id and credential_id are required", 400);
      }

      const creds = await this.getCredentials(user_id, credential_id);

      if (!creds.api_key) {
        throw createError("Invalid FinnHub API credentials", 400);
      }

      let result;
      switch (operation) {
        case "get_quote":
          result = await this.getQuote(creds, input);
          break;
        default:
          throw createError(`Unsupported FinnHub operation: ${operation}`, 400);
      }

      return createSuccessOutput(result, context);
    } catch (error: any) {
      return createErrorOutput(error, context);
    }
  }

  private async getQuote(creds: any, input: DataInput): Promise<any> {
    const { ticker } = input;

    if (!ticker) {
      throw createError("ticker is required", 400);
    }

    const response = await axios.get(`${this.baseUrl}/quote`, {
      params: {
        symbol: ticker.toUpperCase(),
        token: creds.api_key,
      },
      timeout: 10000,
    });

    return {
      symbol: ticker.toUpperCase(),
      data: response.data,
    };
  }
}

// Yahoo Finance service
class YahooFinanceService extends BaseDataService {
  protected serviceName = "yahoofinance";

  async execute(
    operation: string,
    input: DataInput
  ): Promise<StandardNodeOutput> {
    const context = { nodeName: "YahooFinance", category: "data" };
    try {
      let result;
      switch (operation) {
        case "get_quote":
          result = await this.getQuote(input);
          break;
        case "get_history":
          result = await this.getHistory(input);
          break;
        case "search":
          result = await this.search(input);
          break;
        case "get_summary":
          result = await this.getSummary(input);
          break;
        case "get_trending":
          result = await this.getTrending(input);
          break;
        default:
          throw createError(
            `Unsupported Yahoo Finance operation: ${operation}`,
            400
          );
      }

      return createSuccessOutput(result, context);
    } catch (error: any) {
      return createErrorOutput(error, context);
    }
  }

  public async getQuote(input: DataInput): Promise<any> {
    const { symbol } = input;

    if (!symbol) {
      throw createError("symbol is required", 400);
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

  private async getHistory(input: DataInput): Promise<any> {
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
      throw createError("symbol is required", 400);
    }

    let startDate: Date;
    let endDate: Date;

    // If period1/period2 are already provided (from HTTP route), use them
    if (period1 || period2) {
      if (typeof period1 === "number") {
        startDate = new Date(period1 * 1000);
      } else if (period1) {
        startDate = new Date(period1);
      } else {
        startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      }

      if (typeof period2 === "number") {
        endDate = new Date(period2 * 1000);
      } else if (period2) {
        endDate = new Date(period2);
      } else {
        endDate = new Date();
      }
    }
    // Handle date_mode for direct executor calls
    else if (date_mode === "range") {
      if (!start_date) {
        throw createError("start_date is required for range mode", 400);
      }
      startDate = new Date(start_date);
      endDate = end_date ? new Date(end_date) : new Date();
    }
    // Lookback mode (default)
    else {
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

    const options = {
      period1: startDate,
      period2: endDate,
      interval: interval as
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
        | "3mo",
    };

    const chart = await yahooFinance.chart(symbol, options);
    const history = chart.quotes || [];
    console.log(`Retrieved ${history.length} historical records for ${symbol}`);

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

  private async search(input: DataInput): Promise<any> {
    const { query } = input;

    if (!query) {
      throw createError("query is required", 400);
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
          .filter(
            (quote): quote is NonNullable<typeof quote> => quote !== null
          ) || [],
    };
  }

  private async getSummary(input: DataInput): Promise<any> {
    const indices = ["^GSPC", "^DJI", "^IXIC", "^RUT"]; // S&P 500, Dow, Nasdaq, Russell 2000
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

  private async getTrending(input: DataInput): Promise<any> {
    const trending = (await yahooFinance.trendingSymbols(
      "US"
    )) as TrendingSymbolsResult;

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

// Polygon service
class PolygonService extends BaseDataService {
  protected serviceName = "polygon";
  private baseUrl = "https://api.polygon.io";

  async execute(
    operation: string,
    input: DataInput
  ): Promise<StandardNodeOutput> {
    const context = { nodeName: "Polygon", category: "data" };
    try {
      const { user_id, credential_id, api_key } = input;

      // For validation, api_key is passed directly
      if (operation === "validate_credentials") {
        return this.validateCredentials(api_key);
      }

      // For list_credentials, just return stored credentials
      if (operation === "list_credentials") {
        return this.listCredentials(user_id!);
      }

      if (!user_id || !credential_id) {
        throw new Error("user_id and credential_id are required");
      }

      const creds = await this.getCredentials(user_id, credential_id);

      if (!creds.api_key) {
        throw new Error("Invalid Polygon API credentials");
      }

      let result;
      switch (operation) {
        case "ticker_details":
          result = await this.getTickerDetails(creds, input);
          break;
        case "financials":
          result = await this.getFinancials(creds, input);
          break;
        case "dividends":
          result = await this.getDividends(creds, input);
          break;
        case "splits":
          result = await this.getSplits(creds, input);
          break;
        case "news":
          result = await this.getStockNews(creds, input);
          break;
        case "general_news":
          result = await this.getGeneralNews(creds, input);
          break;
        case "stock_news":
          result = await this.getStockNews(creds, input);
          break;
        case "press_releases":
          result = await this.getPressReleases(creds, input);
          break;
        case "crypto_news":
          result = await this.getCryptoNews(creds, input);
          break;
        case "forex_news":
          result = await this.getForexNews(creds, input);
          break;
        case "fmp_articles":
          result = await this.getFmpArticles(creds, input);
          break;
        case "search_stock_news":
          result = await this.searchStockNews(creds, input);
          break;
        case "search_press_releases":
          result = await this.searchPressReleases(creds, input);
          break;
        case "search_crypto_news":
          result = await this.searchCryptoNews(creds, input);
          break;
        case "search_forex_news":
          result = await this.searchForexNews(creds, input);
          break;
        case "related_companies":
          result = await this.getRelatedCompanies(creds, input);
          break;
        default:
          throw new Error(`Unsupported Polygon operation: ${operation}`);
      }

      return createSuccessOutput(result, context);
    } catch (error: any) {
      return createErrorOutput(error, context);
    }
  }

  private async validateCredentials(
    apiKey: string
  ): Promise<StandardNodeOutput> {
    const context = { nodeName: "Polygon", category: "data" };
    try {
      const response = await axios.get(
        `${this.baseUrl}/v3/reference/tickers/AAPL`,
        {
          params: { apiKey },
          timeout: 10000,
        }
      );

      if (response.data && response.data.results) {
        return createSuccessOutput({ valid: true }, context);
      }
      return createErrorOutput("Invalid API response", context);
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        return createErrorOutput("Invalid Polygon API key", context);
      }
      return createErrorOutput(error, context);
    }
  }

  private async listCredentials(userId: string): Promise<StandardNodeOutput> {
    const context = { nodeName: "Polygon", category: "data" };
    const { data, error } = await supabase
      .from("user_credentials")
      .select("id, name, created_at")
      .eq("user_id", userId)
      .eq("service_type", "polygon");

    if (error) {
      return createErrorOutput(error.message, context);
    }

    return createSuccessOutput(data || [], context);
  }

  private async getTickerDetails(creds: any, input: DataInput): Promise<any> {
    const { ticker } = input;
    if (!ticker) throw new Error("ticker is required");

    const response = await axios.get(
      `${this.baseUrl}/v3/reference/tickers/${ticker.toUpperCase()}`,
      {
        params: { apiKey: creds.api_key },
        timeout: 10000,
      }
    );

    return response.data.results;
  }

  private async getFinancials(creds: any, input: DataInput): Promise<any> {
    const { ticker, timeframe = "annual", limit = 10 } = input;
    if (!ticker) throw new Error("ticker is required");

    const response = await axios.get(
      `${this.baseUrl}/vX/reference/financials`,
      {
        params: {
          ticker: ticker.toUpperCase(),
          timeframe,
          limit,
          apiKey: creds.api_key,
        },
        timeout: 15000,
      }
    );

    return response.data.results;
  }

  private async getDividends(creds: any, input: DataInput): Promise<any> {
    const { ticker, limit = 10 } = input;
    if (!ticker) throw new Error("ticker is required");

    const response = await axios.get(`${this.baseUrl}/v3/reference/dividends`, {
      params: {
        ticker: ticker.toUpperCase(),
        limit,
        apiKey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data.results;
  }

  private async getSplits(creds: any, input: DataInput): Promise<any> {
    const { ticker, limit = 10 } = input;
    if (!ticker) throw new Error("ticker is required");

    const response = await axios.get(`${this.baseUrl}/v3/reference/splits`, {
      params: {
        ticker: ticker.toUpperCase(),
        limit,
        apiKey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data.results;
  }

  private async getNews(creds: any, input: DataInput): Promise<any> {
    const { ticker, limit = 10 } = input;
    if (!ticker) throw new Error("ticker is required");

    const response = await axios.get(`${this.baseUrl}/v2/reference/news`, {
      params: {
        ticker: ticker.toUpperCase(),
        limit,
        apiKey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data.results;
  }

  private async getRelatedCompanies(
    creds: any,
    input: DataInput
  ): Promise<any> {
    const { ticker } = input;
    if (!ticker) throw new Error("ticker is required");

    const response = await axios.get(
      `${this.baseUrl}/v1/related-companies/${ticker.toUpperCase()}`,
      {
        params: { apiKey: creds.api_key },
        timeout: 10000,
      }
    );

    return response.data.results;
  }
}

// FMP (Financial Modeling Prep) service
class FMPService extends BaseDataService {
  protected serviceName = "fmp";
  private baseUrl = "https://financialmodelingprep.com/stable";

  async execute(
    operation: string,
    input: DataInput
  ): Promise<StandardNodeOutput> {
    const context = { nodeName: "FMP", category: "data" };
    try {
      const { user_id, credential_id } = input;

      if (!user_id || !credential_id) {
        throw new Error("user_id and credential_id are required");
      }

      const creds = await this.getCredentials(user_id, credential_id);

      if (!creds.api_key) {
        throw new Error("Invalid FMP API credentials");
      }

      let result;
      switch (operation) {
        case "profile":
          result = await this.getProfile(creds, input);
          break;
        case "quote":
          result = await this.getQuote(creds, input);
          break;
        case "income_statement":
          result = await this.getIncomeStatement(creds, input);
          break;
        case "balance_sheet":
          result = await this.getBalanceSheet(creds, input);
          break;
        case "cash_flow":
          result = await this.getCashFlow(creds, input);
          break;
        case "key_metrics":
          result = await this.getKeyMetrics(creds, input);
          break;
        case "ratios":
          result = await this.getRatios(creds, input);
          break;
        case "financial_growth":
          result = await this.getFinancialGrowth(creds, input);
          break;
        case "financial_scores":
          result = await this.getFinancialScores(creds, input);
          break;
        case "enterprise_value":
          result = await this.getEnterpriseValue(creds, input);
          break;
        case "stock_peers":
          result = await this.getStockPeers(creds, input);
          break;
        case "analyst_estimates":
          result = await this.getAnalystEstimates(creds, input);
          break;
        case "price_target":
          result = await this.getPriceTarget(creds, input);
          break;
        case "earnings_calendar":
          result = await this.getEarningsCalendar(creds, input);
          break;
        case "dividends":
          result = await this.getDividends(creds, input);
          break;
        case "splits":
          result = await this.getSplits(creds, input);
          break;
        case "news":
          result = await this.getStockNews(creds, input);
          break;
        case "general_news":
          result = await this.getGeneralNews(creds, input);
          break;
        case "stock_news":
          result = await this.getStockNews(creds, input);
          break;
        case "press_releases":
          result = await this.getPressReleases(creds, input);
          break;
        case "crypto_news":
          result = await this.getCryptoNews(creds, input);
          break;
        case "forex_news":
          result = await this.getForexNews(creds, input);
          break;
        case "fmp_articles":
          result = await this.getFmpArticles(creds, input);
          break;
        case "search_stock_news":
          result = await this.searchStockNews(creds, input);
          break;
        case "search_press_releases":
          result = await this.searchPressReleases(creds, input);
          break;
        case "search_crypto_news":
          result = await this.searchCryptoNews(creds, input);
          break;
        case "search_forex_news":
          result = await this.searchForexNews(creds, input);
          break;
        case "insider_trading":
          result = await this.getInsiderTrading(creds, input);
          break;
        case "institutional_holders":
          result = await this.getInstitutionalHolders(creds, input);
          break;
        default:
          throw new Error(`Unsupported FMP operation: ${operation}`);
      }

      return createSuccessOutput(result, context);
    } catch (error: any) {
      return createErrorOutput(error, context);
    }
  }

  private async validateCredentials(
    apiKey: string
  ): Promise<StandardNodeOutput> {
    const context = { nodeName: "FMP", category: "data" };
    try {
      const response = await axios.get(`${this.baseUrl}/profile`, {
        params: { symbol: "AAPL", apikey: apiKey },
        timeout: 10000,
      });

      if (
        response.data &&
        Array.isArray(response.data) &&
        response.data.length > 0
      ) {
        return createSuccessOutput({ valid: true }, context);
      }
      return createErrorOutput("Invalid API response", context);
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        return createErrorOutput("Invalid FMP API key", context);
      }
      return createErrorOutput(error, context);
    }
  }

  private async listCredentials(userId: string): Promise<StandardNodeOutput> {
    const context = { nodeName: "FMP", category: "data" };
    const { data, error } = await supabase
      .from("user_credentials")
      .select("id, name, created_at")
      .eq("user_id", userId)
      .eq("service_type", "fmp");

    if (error) {
      return createErrorOutput(error.message, context);
    }

    return createSuccessOutput(data || [], context);
  }

  private async getProfile(creds: any, input: DataInput): Promise<any> {
    const { symbol } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/profile`, {
      params: { symbol: symbol.toUpperCase(), apikey: creds.api_key },
      timeout: 10000,
    });

    return response.data;
  }

  private async getQuote(creds: any, input: DataInput): Promise<any> {
    const { symbol } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/quote`, {
      params: { symbol: symbol.toUpperCase(), apikey: creds.api_key },
      timeout: 10000,
    });

    return response.data;
  }

  private async getIncomeStatement(creds: any, input: DataInput): Promise<any> {
    const { symbol, period = "annual", limit = 10 } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/income-statement`, {
      params: {
        symbol: symbol.toUpperCase(),
        period,
        limit,
        apikey: creds.api_key,
      },
      timeout: 15000,
    });

    return response.data;
  }

  private async getBalanceSheet(creds: any, input: DataInput): Promise<any> {
    const { symbol, period = "annual", limit = 10 } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(
      `${this.baseUrl}/balance-sheet-statement`,
      {
        params: {
          symbol: symbol.toUpperCase(),
          period,
          limit,
          apikey: creds.api_key,
        },
        timeout: 15000,
      }
    );

    return response.data;
  }

  private async getCashFlow(creds: any, input: DataInput): Promise<any> {
    const { symbol, period = "annual", limit = 10 } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/cash-flow-statement`, {
      params: {
        symbol: symbol.toUpperCase(),
        period,
        limit,
        apikey: creds.api_key,
      },
      timeout: 15000,
    });

    return response.data;
  }

  private async getKeyMetrics(creds: any, input: DataInput): Promise<any> {
    const { symbol, period = "annual", limit = 10 } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/key-metrics`, {
      params: {
        symbol: symbol.toUpperCase(),
        period,
        limit,
        apikey: creds.api_key,
      },
      timeout: 15000,
    });

    return response.data;
  }

  private async getRatios(creds: any, input: DataInput): Promise<any> {
    const { symbol, period = "annual", limit = 10 } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/ratios`, {
      params: {
        symbol: symbol.toUpperCase(),
        period,
        limit,
        apikey: creds.api_key,
      },
      timeout: 15000,
    });

    return response.data;
  }

  private async getFinancialGrowth(creds: any, input: DataInput): Promise<any> {
    const { symbol, period = "annual", limit = 10 } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/financial-growth`, {
      params: {
        symbol: symbol.toUpperCase(),
        period,
        limit,
        apikey: creds.api_key,
      },
      timeout: 15000,
    });

    return response.data;
  }

  private async getFinancialScores(creds: any, input: DataInput): Promise<any> {
    const { symbol } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/score`, {
      params: { symbol: symbol.toUpperCase(), apikey: creds.api_key },
      timeout: 10000,
    });

    return response.data;
  }

  private async getEnterpriseValue(creds: any, input: DataInput): Promise<any> {
    const { symbol, limit = 10 } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/enterprise-values`, {
      params: {
        symbol: symbol.toUpperCase(),
        limit,
        apikey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private async getStockPeers(creds: any, input: DataInput): Promise<any> {
    const { symbol } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/stock_peers`, {
      params: { symbol: symbol.toUpperCase(), apikey: creds.api_key },
      timeout: 10000,
    });

    return response.data;
  }

  private async getAnalystEstimates(
    creds: any,
    input: DataInput
  ): Promise<any> {
    const { symbol, limit = 10 } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/analyst-estimates`, {
      params: {
        symbol: symbol.toUpperCase(),
        limit,
        apikey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private async getPriceTarget(creds: any, input: DataInput): Promise<any> {
    const { symbol, limit = 10 } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/price-target`, {
      params: {
        symbol: symbol.toUpperCase(),
        limit,
        apikey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private async getEarningsCalendar(
    creds: any,
    input: DataInput
  ): Promise<any> {
    const { symbol, limit = 10 } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/earning_calendar`, {
      params: {
        symbol: symbol.toUpperCase(),
        limit,
        apikey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private async getDividends(creds: any, input: DataInput): Promise<any> {
    const { symbol, limit = 10 } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(
      `${this.baseUrl}/historical-price-eod/dividend`,
      {
        params: {
          symbol: symbol.toUpperCase(),
          limit,
          apikey: creds.api_key,
        },
        timeout: 10000,
      }
    );

    return response.data;
  }

  private async getSplits(creds: any, input: DataInput): Promise<any> {
    const { symbol, limit = 10 } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(
      `${this.baseUrl}/historical-price-eod/stock_split`,
      {
        params: {
          symbol: symbol.toUpperCase(),
          limit,
          apikey: creds.api_key,
        },
        timeout: 10000,
      }
    );

    return response.data;
  }

  private async getGeneralNews(creds: any, input: DataInput): Promise<any> {
    const { limit = 10, page, from, to } = input;

    const response = await axios.get(`${this.baseUrl}/news`, {
      params: {
        limit,
        page,
        from,
        to,
        apikey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private async getStockNews(creds: any, input: DataInput): Promise<any> {
    const { tickers, symbol, limit = 10, page, from, to } = input;
    const resolvedTickers = tickers || symbol;
    if (!resolvedTickers) throw new Error("tickers is required");

    const response = await axios.get(`${this.baseUrl}/stock_news`, {
      params: {
        tickers: String(resolvedTickers).toUpperCase(),
        limit,
        page,
        from,
        to,
        apikey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private async getPressReleases(creds: any, input: DataInput): Promise<any> {
    const { symbol, limit = 10, page } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/press-releases`, {
      params: {
        symbol: symbol.toUpperCase(),
        limit,
        page,
        apikey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private async getCryptoNews(creds: any, input: DataInput): Promise<any> {
    const { symbol, limit = 10, page } = input;

    const response = await axios.get(`${this.baseUrl}/crypto_news`, {
      params: {
        symbol: symbol ? symbol.toUpperCase() : undefined,
        limit,
        page,
        apikey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private async getForexNews(creds: any, input: DataInput): Promise<any> {
    const { symbol, limit = 10, page } = input;

    const response = await axios.get(`${this.baseUrl}/forex_news`, {
      params: {
        symbol: symbol ? symbol.toUpperCase() : undefined,
        limit,
        page,
        apikey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private async getFmpArticles(creds: any, input: DataInput): Promise<any> {
    const { limit = 10, page } = input;

    const response = await axios.get(`${this.baseUrl}/fmp-articles`, {
      params: {
        limit,
        page,
        apikey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private async searchStockNews(creds: any, input: DataInput): Promise<any> {
    const { query, tickers, limit = 10 } = input;
    if (!query) throw new Error("query is required");

    const response = await axios.get(`${this.baseUrl}/stock_news/search`, {
      params: {
        query,
        tickers: tickers ? String(tickers).toUpperCase() : undefined,
        limit,
        apikey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private async searchPressReleases(
    creds: any,
    input: DataInput
  ): Promise<any> {
    const { query, symbol, limit = 10 } = input;
    if (!query) throw new Error("query is required");

    const response = await axios.get(`${this.baseUrl}/press-releases/search`, {
      params: {
        query,
        symbol: symbol ? symbol.toUpperCase() : undefined,
        limit,
        apikey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private async searchCryptoNews(creds: any, input: DataInput): Promise<any> {
    const { query, symbol, limit = 10 } = input;
    if (!query) throw new Error("query is required");

    const response = await axios.get(`${this.baseUrl}/crypto_news/search`, {
      params: {
        query,
        symbol: symbol ? symbol.toUpperCase() : undefined,
        limit,
        apikey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private async searchForexNews(creds: any, input: DataInput): Promise<any> {
    const { query, symbol, limit = 10 } = input;
    if (!query) throw new Error("query is required");

    const response = await axios.get(`${this.baseUrl}/forex_news/search`, {
      params: {
        query,
        symbol: symbol ? symbol.toUpperCase() : undefined,
        limit,
        apikey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private async getInsiderTrading(creds: any, input: DataInput): Promise<any> {
    const { symbol, limit = 10 } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/insider-trading`, {
      params: {
        symbol: symbol.toUpperCase(),
        limit,
        apikey: creds.api_key,
      },
      timeout: 10000,
    });

    return response.data;
  }

  private async getInstitutionalHolders(
    creds: any,
    input: DataInput
  ): Promise<any> {
    const { symbol } = input;
    if (!symbol) throw new Error("symbol is required");

    const response = await axios.get(`${this.baseUrl}/institutional-holder`, {
      params: { symbol: symbol.toUpperCase(), apikey: creds.api_key },
      timeout: 10000,
    });

    return response.data;
  }

}

// Market service (simple market data aggregator)
class MarketService extends BaseDataService {
  protected serviceName = "market";

  async execute(
    operation: string,
    input: DataInput
  ): Promise<StandardNodeOutput> {
    const context = { nodeName: "Market", category: "data" };
    try {
      let result;
      switch (operation) {
        case "get_quote":
        case "get_market_data":
          // Use Yahoo Finance as default market data provider
          const yahooService = new YahooFinanceService();
          result = await yahooService.getQuote(input);
          break;
        default:
          throw createError(`Unsupported Market operation: ${operation}`, 400);
      }

      return createSuccessOutput(result, context);
    } catch (error: any) {
      return createErrorOutput(error, context);
    }
  }
}

// Main data service
export class DataService {
  private static finnhubService = new FinnHubService();
  private static yahooFinanceService = new YahooFinanceService();
  private static marketService = new MarketService();
  private static polygonService = new PolygonService();
  private static fmpService = new FMPService();

  static async execute(
    service: string,
    operation: string,
    input: DataInput
  ): Promise<StandardNodeOutput> {
    const context = { nodeName: service, category: "data" };
    switch (service.toLowerCase()) {
      case "finnhub":
        return this.finnhubService.execute(operation, input);
      case "yahoofinance":
        return this.yahooFinanceService.execute(operation, input);
      case "market":
        return this.marketService.execute(operation, input);
      case "polygon":
        return this.polygonService.execute(operation, input);
      case "fmp":
        return this.fmpService.execute(operation, input);
      default:
        return createErrorOutput(
          `Unsupported data service: ${service}`,
          context
        );
    }
  }

  // Backwards compatibility method for MarketExecutor
  static async getMarketData(input: DataInput): Promise<StandardNodeOutput> {
    return this.marketService.execute("get_market_data", input);
  }
}
