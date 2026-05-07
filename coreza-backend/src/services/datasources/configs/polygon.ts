/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import axios from "axios";
import { DataSourceConfig } from "../dataSource";
import { DataSourceInput } from "../types";

const cleanParams = (params: Record<string, any>): Record<string, any> => {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== "" && value !== null
    )
  );
};

export const polygonDataSourceConfig: DataSourceConfig = {
  authType: "api_key",
  baseUrl: "https://api.polygon.io",

  makeAuthHeaders: () => ({}), // Polygon uses query param auth

  validateCredentials: async (apiKey: string) => {
    try {
      const response = await axios.get(
        "https://api.polygon.io/v3/reference/tickers/AAPL",
        {
          params: { apiKey },
          timeout: 10000,
        }
      );
      if (response.data && response.data.results) {
        return { valid: true };
      }
      return { valid: false, error: "Invalid API response" };
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        return { valid: false, error: "Invalid Polygon API key" };
      }
      return { valid: false, error: error.message || "Validation failed" };
    }
  },

  ops: {
    ticker_details: {
      method: "get",
      path: (input: DataSourceInput) =>
        `/v3/reference/tickers/${input.ticker?.toUpperCase()}`,
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          apiKey: creds?.api_key,
        }),
      transformResult: (data: any) => data.results,
    },

    financials: {
      method: "get",
      path: "/vX/reference/financials",
      timeout: 15000,
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          ticker: input.ticker?.toUpperCase(),
          timeframe: input.timeframe || "annual",
          limit: input.limit || 10,
          apiKey: creds?.api_key,
        }),
      transformResult: (data: any) => data.results,
    },

    dividends: {
      method: "get",
      path: "/v3/reference/dividends",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          ticker: input.ticker?.toUpperCase(),
          limit: input.limit || 10,
          apiKey: creds?.api_key,
        }),
      transformResult: (data: any) => data.results,
    },

    splits: {
      method: "get",
      path: "/v3/reference/splits",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          ticker: input.ticker?.toUpperCase(),
          limit: input.limit || 10,
          apiKey: creds?.api_key,
        }),
      transformResult: (data: any) => data.results,
    },

    news: {
      method: "get",
      path: "/v2/reference/news",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          ticker: input.ticker?.toUpperCase(),
          limit: input.limit || 10,
          apiKey: creds?.api_key,
        }),
      transformResult: (data: any) => data.results,
    },

    related_companies: {
      method: "get",
      path: (input: DataSourceInput) =>
        `/v1/related-companies/${input.ticker?.toUpperCase()}`,
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          apiKey: creds?.api_key,
        }),
      transformResult: (data: any) => data.results,
    },
  },
};
