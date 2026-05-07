/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { ScreenerConfig } from "../screener";
import { ScreenerInput } from "../types";

export const fmpScreenerConfig: ScreenerConfig = {
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
