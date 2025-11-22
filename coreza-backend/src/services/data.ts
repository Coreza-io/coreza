import axios from "axios";
import yahooFinance from "yahoo-finance2";
import type { Quote } from "yahoo-finance2/dist/esm/src/modules/quote";
import type { SearchResult } from "yahoo-finance2/dist/esm/src/modules/search";
import type { TrendingSymbolsResult } from "yahoo-finance2/dist/esm/src/modules/trendingSymbols";
import { supabase } from "../config/supabase";
import { createError } from "../middleware/errorHandler";
import DecryptionUtil from "../utils/decryption";
import CredentialManager from "../utils/credentialManager";

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
    try {
      const { data, error } = await supabase
        .from("user_credentials")
        .select("client_json, token_json")
        .eq("user_id", userId)
        .eq("name", credentialId)
        .eq("service_type", this.serviceName)
        .single();

      if (error || !data) {
        throw createError(`${this.serviceName} credentials not found`, 404);
      }

      // Decrypt credentials before returning
      const decryptedClientJson = { ...data.client_json };
      const decryptedTokenJson = data.token_json ? { ...data.token_json } : {};

      try {
        // Decrypt sensitive fields if they appear to be encrypted
        if (
          decryptedClientJson.api_key &&
          DecryptionUtil.isEncrypted(decryptedClientJson.api_key)
        ) {
          decryptedClientJson.api_key = await DecryptionUtil.decrypt(
            decryptedClientJson.api_key
          );
        }

        if (
          decryptedClientJson.secret_key &&
          DecryptionUtil.isEncrypted(decryptedClientJson.secret_key)
        ) {
          decryptedClientJson.secret_key = await DecryptionUtil.decrypt(
            decryptedClientJson.secret_key
          );
        }

        if (
          decryptedTokenJson.access_token &&
          DecryptionUtil.isEncrypted(decryptedTokenJson.access_token)
        ) {
          decryptedTokenJson.access_token = await DecryptionUtil.decrypt(
            decryptedTokenJson.access_token
          );
        }
      } catch (decryptError) {
        console.error(
          `Error decrypting ${this.serviceName} credentials:`,
          decryptError
        );
        throw new Error(`Failed to decrypt ${this.serviceName} credentials`);
      }

      return {
        ...decryptedClientJson,
        ...decryptedTokenJson,
      };
    } catch (error) {
      throw new Error(
        `Failed to get ${this.serviceName} credentials: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  abstract execute(operation: string, input: DataInput): Promise<DataResult>;
}

// FinnHub service
class FinnHubService extends BaseDataService {
  protected serviceName = "finnhub";
  private baseUrl = "https://finnhub.io/api/v1";

  async execute(operation: string, input: DataInput): Promise<DataResult> {
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

      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
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

  async execute(operation: string, input: DataInput): Promise<DataResult> {
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

      return result;
    } catch (error: any) {
      return { success: false, error: error.message };
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
    const { symbol, period1, period2, interval = "1d" } = input;

    if (!symbol) {
      throw createError("symbol is required", 400);
    }

    console.log(`Fetching Yahoo Finance historical data for ${symbol}`, {
      period1,
      period2,
      interval,
    });

    try {
      // Convert dates to proper format for yahoo-finance2
      let startDate, endDate;

      if (typeof period1 === "number") {
        startDate = new Date(period1 * 1000);
      } else if (period1) {
        startDate = new Date(period1);
      } else {
        startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1 year ago
      }

      if (typeof period2 === "number") {
        endDate = new Date(period2 * 1000);
      } else if (period2) {
        endDate = new Date(period2);
      } else {
        endDate = new Date(); // today
      }

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

      console.log("Yahoo Finance options:", {
        symbol,
        period1: startDate.toISOString(),
        period2: endDate.toISOString(),
        interval,
      });

      const chart = await yahooFinance.chart(symbol, options);
      const history = chart.quotes || [];
      console.log(
        `Retrieved ${history.length} historical records for ${symbol}`
      );

      return {
        success: true,
        data: history.map((item) => ({
          date: item.date,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
          volume: item.volume,
          adjClose: item.adjclose,
        })),
      };
    } catch (error) {
      console.error(
        `Error fetching Yahoo Finance historical data for ${symbol}:`,
        error
      );
      throw createError(
        `Failed to fetch historical data for ${symbol}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        500
      );
    }
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
          .filter((quote): quote is NonNullable<typeof quote> => quote !== null) || [],
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

// Market service (simple market data aggregator)
class MarketService extends BaseDataService {
  protected serviceName = "market";

  async execute(operation: string, input: DataInput): Promise<DataResult> {
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

      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

// Main data service
export class DataService {
  private static finnhubService = new FinnHubService();
  private static yahooFinanceService = new YahooFinanceService();
  private static marketService = new MarketService();

  static async execute(
    service: string,
    operation: string,
    input: DataInput
  ): Promise<DataResult> {
    switch (service.toLowerCase()) {
      case "finnhub":
        return this.finnhubService.execute(operation, input);
      case "yahoofinance":
        return this.yahooFinanceService.execute(operation, input);
      case "market":
        return this.marketService.execute(operation, input);
      default:
        return {
          success: false,
          error: `Unsupported data service: ${service}`,
        };
    }
  }

  // Backwards compatibility method for MarketExecutor
  static async getMarketData(input: DataInput): Promise<DataResult> {
    return this.marketService.execute("get_market_data", input);
  }
}
