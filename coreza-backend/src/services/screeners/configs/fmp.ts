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
        if (input.marketCapMoreThan) {
          params.marketCapMoreThan = parseFloat(input.marketCapMoreThan);
        }
        if (input.marketCapLowerThan) {
          params.marketCapLowerThan = parseFloat(input.marketCapLowerThan);
        }
        if (input.priceMoreThan) {
          params.priceMoreThan = parseFloat(input.priceMoreThan);
        }
        if (input.priceLowerThan) {
          params.priceLowerThan = parseFloat(input.priceLowerThan);
        }
        if (input.betaMoreThan) {
          params.betaMoreThan = parseFloat(input.betaMoreThan);
        }
        if (input.betaLowerThan) {
          params.betaLowerThan = parseFloat(input.betaLowerThan);
        }
        if (input.volumeMoreThan) {
          params.volumeMoreThan = parseFloat(input.volumeMoreThan);
        }
        if (input.dividendMoreThan) {
          params.dividendMoreThan = parseFloat(input.dividendMoreThan);
        }
        if (input.dividendLowerThan) {
          params.dividendLowerThan = parseFloat(input.dividendLowerThan);
        }
        if (input.sector) params.sector = input.sector;
        if (input.industry) params.industry = input.industry;
        if (input.country) params.country = input.country;
        if (input.exchange) params.exchange = input.exchange;
        if (input.isEtf !== undefined && input.isEtf !== "") {
          params.isEtf = input.is_etf === "true";
        }
        if (
          input.isActivelyTrading !== undefined &&
          input.isActivelyTrading !== ""
        ) {
          params.isActivelyTrading = input.isActivelyTrading === "true";
        }

        return params;
      },
    },
  },
};
