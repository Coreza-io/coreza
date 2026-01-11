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

import { RestScreenerConfig } from "../RestScreenerService";
import { ScreenerInput } from "../types";

export const fmpScreenerConfig: RestScreenerConfig = {
  baseUrl: "https://financialmodelingprep.com/stable",

  makeAuthHeaders: () => ({}),

  ops: {
    stock_screener: {
      method: "get",
      path: "/company-screener",
      makeParams: (input: ScreenerInput, creds?: any) => {
        if (!creds?.api_key) {
          throw new Error("Missing FMP API credentials");
        }

        const params: Record<string, any> = {
          apikey: creds.api_key,
        };

        if (input.limit) params.limit = Number(input.limit);
        if (input.market_cap_more_than) {
          params.marketCapMoreThan = parseFloat(input.market_cap_more_than);
        }
        if (input.market_cap_lower_than) {
          params.marketCapLowerThan = parseFloat(input.market_cap_lower_than);
        }
        if (input.price_more_than) {
          params.priceMoreThan = parseFloat(input.price_more_than);
        }
        if (input.price_lower_than) {
          params.priceLowerThan = parseFloat(input.price_lower_than);
        }
        if (input.beta_more_than) {
          params.betaMoreThan = parseFloat(input.beta_more_than);
        }
        if (input.beta_lower_than) {
          params.betaLowerThan = parseFloat(input.beta_lower_than);
        }
        if (input.volume_more_than) {
          params.volumeMoreThan = parseFloat(input.volume_more_than);
        }
        if (input.dividend_more_than) {
          params.dividendMoreThan = parseFloat(input.dividend_more_than);
        }
        if (input.dividend_lower_than) {
          params.dividendLowerThan = parseFloat(input.dividend_lower_than);
        }
        if (input.sector) params.sector = input.sector;
        if (input.industry) params.industry = input.industry;
        if (input.country) params.country = input.country;
        if (input.exchange) params.exchange = input.exchange;
        if (input.is_etf !== undefined && input.is_etf !== "") {
          params.isEtf = input.is_etf === "true";
        }
        if (
          input.is_actively_trading !== undefined &&
          input.is_actively_trading !== ""
        ) {
          params.isActivelyTrading = input.is_actively_trading === "true";
        }

        return params;
      },
    },
  },
};
