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

export const finnhubDataSourceConfig: DataSourceConfig = {
  authType: "api_key",
  baseUrl: "https://finnhub.io/api/v1",

  makeAuthHeaders: () => ({}), // FinnHub uses query param auth

  validateCredentials: async (apiKey: string) => {
    try {
      const response = await axios.get(
        "https://finnhub.io/api/v1/quote",
        {
          params: { symbol: "AAPL", token: apiKey },
          timeout: 10000,
        }
      );
      if (response.data && response.data.c !== undefined) {
        return { valid: true };
      }
      return { valid: false, error: "Invalid API response" };
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        return { valid: false, error: "Invalid FinnHub API key" };
      }
      return { valid: false, error: error.message || "Validation failed" };
    }
  },

  ops: {
    get_quote: {
      method: "get",
      path: "/quote",
      makeParams: (input: DataSourceInput, creds?: any) =>
        cleanParams({
          symbol: input.ticker?.toUpperCase() || input.symbol?.toUpperCase(),
          token: creds?.api_key,
        }),
      transformResult: (data: any, input: DataSourceInput) => ({
        symbol: input.ticker?.toUpperCase() || input.symbol?.toUpperCase(),
        data,
      }),
    },
  },
};
