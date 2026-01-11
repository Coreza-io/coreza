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
import { DataSourceConfig } from "../dataSourceService";
import { DataSourceInput } from "../types";

const cleanParams = (params: Record<string, any>): Record<string, any> => {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== "" && value !== null
    )
  );
};

export const fmpDataSourceConfig: DataSourceConfig = {
  authType: "api_key",
  baseUrl: "https://financialmodelingprep.com/stable",

  makeAuthHeaders: () => ({}), // FMP uses query param auth

  validateCredentials: async (apiKey: string) => {
    try {
      const response = await axios.get(
        "https://financialmodelingprep.com/stable/profile",
        {
          params: { symbol: "AAPL", apikey: apiKey },
          timeout: 10000,
        }
      );
      if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        return { valid: true };
      }
      return { valid: false, error: "Invalid API response" };
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        return { valid: false, error: "Invalid FMP API key" };
      }
      return { valid: false, error: error.message || "Validation failed" };
    }
  },

  ops: {
    profile: {
      method: "get",
      path: "/profile",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          apikey: creds?.api_key,
        }),
    },

    quote: {
      method: "get",
      path: "/quote",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          apikey: creds?.api_key,
        }),
    },

    income_statement: {
      method: "get",
      path: "/income-statement",
      timeout: 15000,
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          period: input.period || "annual",
          limit: input.limit || 10,
          apikey: creds?.api_key,
        }),
    },

    balance_sheet: {
      method: "get",
      path: "/balance-sheet-statement",
      timeout: 15000,
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          period: input.period || "annual",
          limit: input.limit || 10,
          apikey: creds?.api_key,
        }),
    },

    cash_flow: {
      method: "get",
      path: "/cash-flow-statement",
      timeout: 15000,
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          period: input.period || "annual",
          limit: input.limit || 10,
          apikey: creds?.api_key,
        }),
    },

    key_metrics: {
      method: "get",
      path: "/key-metrics",
      timeout: 15000,
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          period: input.period || "annual",
          limit: input.limit || 10,
          apikey: creds?.api_key,
        }),
    },

    ratios: {
      method: "get",
      path: "/ratios",
      timeout: 15000,
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          period: input.period || "annual",
          limit: input.limit || 10,
          apikey: creds?.api_key,
        }),
    },

    financial_growth: {
      method: "get",
      path: "/financial-growth",
      timeout: 15000,
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          period: input.period || "annual",
          limit: input.limit || 10,
          apikey: creds?.api_key,
        }),
    },

    financial_scores: {
      method: "get",
      path: "/score",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          apikey: creds?.api_key,
        }),
    },

    enterprise_value: {
      method: "get",
      path: "/enterprise-values",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          limit: input.limit || 10,
          apikey: creds?.api_key,
        }),
    },

    stock_peers: {
      method: "get",
      path: "/stock_peers",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          apikey: creds?.api_key,
        }),
    },

    analyst_estimates: {
      method: "get",
      path: "/analyst-estimates",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          limit: input.limit || 10,
          apikey: creds?.api_key,
        }),
    },

    price_target: {
      method: "get",
      path: "/price-target",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          limit: input.limit || 10,
          apikey: creds?.api_key,
        }),
    },

    earnings_calendar: {
      method: "get",
      path: "/earning_calendar",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          limit: input.limit || 10,
          apikey: creds?.api_key,
        }),
    },

    dividends: {
      method: "get",
      path: "/historical-price-eod/dividend",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          limit: input.limit || 10,
          apikey: creds?.api_key,
        }),
    },

    splits: {
      method: "get",
      path: "/historical-price-eod/stock_split",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          limit: input.limit || 10,
          apikey: creds?.api_key,
        }),
    },

    insider_trading: {
      method: "get",
      path: "/insider-trading",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          limit: input.limit || 10,
          apikey: creds?.api_key,
        }),
    },

    institutional_holders: {
      method: "get",
      path: "/institutional-holder",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol?.toUpperCase(),
          apikey: creds?.api_key,
        }),
    },
  },
};
