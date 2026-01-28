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

import { ScreenerConfig } from "../screener";
import { ScreenerInput } from "../types";

const normalizeSymbols = (symbols: ScreenerInput["symbols"]): string => {
  if (Array.isArray(symbols)) {
    return symbols
      .map((entry) => (typeof entry === "string" ? entry : entry.symbol))
      .join(",");
  }

  if (typeof symbols === "object" && symbols !== null) {
    return Object.values(symbols)
      .map((entry: any) => entry.symbol)
      .join(",");
  }

  return typeof symbols === "string" ? symbols : "";
};

export const schwabScreenerConfig: ScreenerConfig = {
  authType: "oauth",
  baseUrl: "https://api.schwabapi.com/marketdata/v1",

  makeAuthHeaders: (creds: any) => ({
    Authorization: `Bearer ${creds.access_token}`,
  }),

  ops: {
    movers: {
      method: "get",
      path: (input: ScreenerInput) => `/movers/${input.index || "$DJI"}`,
      makeParams: (input: ScreenerInput) => ({
        direction: input.direction || "up",
        change: input.change || "percent",
      }),
      transformResult: (raw: any, input: ScreenerInput) => ({
        movers: raw || [],
        index: input.index,
        direction: input.direction,
      }),
    },
    get_fundamentals: {
      method: "get",
      path: "/quotes",
      makeParams: (input: ScreenerInput) => {
        const normalizedSymbols = normalizeSymbols(input.symbols);
        if (!normalizedSymbols) {
          throw new Error("symbols parameter is required");
        }

        return {
          symbols: normalizedSymbols,
          fields: input.fields || "quote,fundamental,reference",
          indicative: "false",
        };
      },
      transformResult: (raw: any) => {
        const quotes = Object.entries(raw || {}).map(
          ([symbol, data]: [string, any]) => {
            const quote = data.quote || {};
            const fundamental = data.fundamental || {};
            const reference = data.reference || {};

            return {
              symbol,
              lastPrice: quote.lastPrice,
              bidPrice: quote.bidPrice,
              askPrice: quote.askPrice,
              netChange: quote.netChange,
              netPercentChange: quote.netPercentChange,
              totalVolume: quote.totalVolume,
              marketCap: fundamental.marketCap,
              marketCapBillions: fundamental.marketCap
                ? fundamental.marketCap / 1e9
                : 0,
              peRatio: fundamental.peRatio,
              pegRatio: fundamental.pegRatio,
              pbRatio: fundamental.pbRatio,
              dividendYield: fundamental.divYield,
              dividendAmount: fundamental.divAmount,
              dividendDate: fundamental.divDate,
              eps: fundamental.eps,
              high52: fundamental.high52,
              low52: fundamental.low52,
              description: reference.description,
              exchange: reference.exchange,
              exchangeName: reference.exchangeName,
              assetMainType: reference.assetMainType,
              cusip: reference.cusip,
            };
          },
        );

        return {
          quotes,
          count: quotes.length,
          source: "schwab_fundamentals",
        };
      },
    },
    get_instruments: {
      method: "get",
      path: "/instruments",
      makeParams: (input: ScreenerInput) => {
        if (!input.symbol) {
          throw new Error("symbol parameter is required");
        }

        return {
          symbol: input.symbol,
          projection: input.projection || "symbol-search",
        };
      },
      transformResult: (raw: any) => ({
        instruments: raw.instruments || [],
        count: raw.instruments?.length || 0,
        source: "schwab_instruments",
      }),
    },
    get_instrument_cusip: {
      method: "get",
      path: (input: ScreenerInput) => {
        if (!input.cusip) {
          throw new Error("cusip parameter is required");
        }
        return `/instruments/${input.cusip}`;
      },
      transformResult: (raw: any) => ({
        instruments: raw.instruments || [],
        count: 1,
        source: "schwab_instruments",
      }),
    },
  },
};
