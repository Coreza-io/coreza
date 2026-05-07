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

export const fmpNewsDataSourceConfig: DataSourceConfig = {
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
      if (
        response.data &&
        Array.isArray(response.data) &&
        response.data.length > 0
      ) {
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
    general_news: {
      method: "get",
      path: "/news/general-latest",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          limit: input.limit,
          page: input.page,
          from: input.from,
          to: input.to,
          apikey: creds?.api_key,
        }),
    },

    stock_news: {
      method: "get",
      path: "/news/stock-latest",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          limit: input.limit,
          page: input.page,
          from: input.from,
          to: input.to,
          apikey: creds?.api_key,
        }),
    },

    press_releases: {
      method: "get",
      path: "/news/press-releases-latest",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          from: input.from,
          to: input.to,
          limit: input.limit,
          page: input.page,
          apikey: creds?.api_key,
        }),
    },

    crypto_news: {
      method: "get",
      path: "/news/crypto-latest",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          limit: input.limit,
          page: input.page,
          from: input.from,
          to: input.to,
          apikey: creds?.api_key,
        }),
    },

    forex_news: {
      method: "get",
      path: "/news/forex-latest",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          limit: input.limit,
          page: input.page,
          from: input.from,
          to: input.to,
          apikey: creds?.api_key,
        }),
    },

    fmp_articles: {
      method: "get",
      path: "/fmp-articles",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          limit: input.limit,
          page: input.page,
          apikey: creds?.api_key,
        }),
    },

    search_stock_news: {
      method: "get",
      path: "/news/stock",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbols: input.symbols,
          from: input.from,
          to: input.to,
          limit: input.limit,
          page: input.page,
          apikey: creds?.api_key,
        }),
    },

    search_press_releases: {
      method: "get",
      path: "/press-releases/search",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbols: input.symbols,
          from: input.from,
          to: input.to,
          page: input.page,
          limit: input.limit,
          apikey: creds?.api_key,
        }),
    },

    search_crypto_news: {
      method: "get",
      path: "/crypto_news/search",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.symbol,
          from: input.from,
          to: input.to,
          page: input.page,
          limit: input.limit,
          apikey: creds?.api_key,
        }),
    },

    search_forex_news: {
      method: "get",
      path: "/forex_news/search",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbols: input.symbols,
          from: input.from,
          to: input.to,
          page: input.page,
          limit: input.limit,
          apikey: creds?.api_key,
        }),
    },
  },
};
