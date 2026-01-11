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

import { ScreenerConfig } from '../ScreenerService';
import { ScreenerInput } from '../types';

const BASE_COUNT = 100;

const extractQuotes = (raw: any): any[] => {
  const result = raw?.finance?.result;
  if (!Array.isArray(result) || result.length === 0) {
    return [];
  }

  return result[0]?.quotes ?? [];
};

const transformQuote = (quote: any) => ({
  symbol: quote.symbol,
  current_price: quote.regularMarketPrice,
  previous_close: quote.regularMarketPreviousClose,
  gap_percent: quote.regularMarketChangePercent,
  change_dollar: quote.regularMarketChange,
  current_volume: quote.regularMarketVolume,
  avg_volume: quote.averageDailyVolume3Month,
  volume_ratio: quote.averageDailyVolume3Month
    ? quote.regularMarketVolume / quote.averageDailyVolume3Month
    : 0,
  market_cap: quote.marketCap,
  market_cap_billions: quote.marketCap ? quote.marketCap / 1e9 : 0,
  pe_ratio: quote.trailingPE,
  short_name: quote.shortName,
  long_name: quote.longName,
  fifty_two_week_high: quote.fiftyTwoWeekHigh,
  fifty_two_week_low: quote.fiftyTwoWeekLow,
});

const buildParams = (input: ScreenerInput, scrId: string) => ({
  scrIds: scrId,
  count: Number(input.count || BASE_COUNT),
});

export const yahoofinanceScreenerConfig: ScreenerConfig = {
  baseUrl: 'https://query1.finance.yahoo.com/v1/finance/screener/predefined',

  makeAuthHeaders: () => ({}),

  ops: {
    day_gainers: {
      method: 'get',
      path: '/saved',
      makeParams: (input: ScreenerInput) => buildParams(input, 'day_gainers'),
      transformResult: (raw: any, input: ScreenerInput) => {
        const minGap = Number(input.min_gap_percent || 0);
        const filtered = extractQuotes(raw).filter(
          (quote) => (quote.regularMarketChangePercent || 0) >= minGap
        );

        return {
          gainers: filtered.map(transformQuote),
          count: filtered.length,
          source: 'yahoo_finance_day_gainers',
        };
      },
    },
    small_cap_gainers: {
      method: 'get',
      path: '/saved',
      makeParams: (input: ScreenerInput) =>
        buildParams(input, 'small_cap_gainers'),
      transformResult: (raw: any) => {
        const quotes = extractQuotes(raw);
        return {
          gainers: quotes.map(transformQuote),
          count: quotes.length,
          source: 'yahoo_finance_small_cap_gainers',
        };
      },
    },
    most_actives: {
      method: 'get',
      path: '/saved',
      makeParams: (input: ScreenerInput) => buildParams(input, 'most_actives'),
      transformResult: (raw: any, input: ScreenerInput) => {
        const minChange = Number(input.min_change_percent || 1.0);
        const filtered = extractQuotes(raw).filter(
          (quote) => Math.abs(quote.regularMarketChangePercent || 0) >= minChange
        );

        return {
          actives: filtered.map(transformQuote),
          count: filtered.length,
          source: 'yahoo_finance_most_actives',
        };
      },
    },
    day_losers: {
      method: 'get',
      path: '/saved',
      makeParams: (input: ScreenerInput) => buildParams(input, 'day_losers'),
      transformResult: (raw: any, input: ScreenerInput) => {
        const minLoss = Number(input.min_loss_percent || 0);
        const filtered = extractQuotes(raw).filter(
          (quote) => (quote.regularMarketChangePercent || 0) <= -minLoss
        );

        return {
          losers: filtered.map(transformQuote),
          count: filtered.length,
          source: 'yahoo_finance_day_losers',
        };
      },
    },
    undervalued_large_caps: {
      method: 'get',
      path: '/saved',
      makeParams: (input: ScreenerInput) =>
        buildParams(input, 'undervalued_large_caps'),
      transformResult: (raw: any) => {
        const quotes = extractQuotes(raw);
        return {
          stocks: quotes.map(transformQuote),
          count: quotes.length,
          source: 'yahoo_finance_undervalued_large_caps',
        };
      },
    },
    growth_technology_stocks: {
      method: 'get',
      path: '/saved',
      makeParams: (input: ScreenerInput) =>
        buildParams(input, 'growth_technology_stocks'),
      transformResult: (raw: any) => {
        const quotes = extractQuotes(raw);
        return {
          stocks: quotes.map(transformQuote),
          count: quotes.length,
          source: 'yahoo_finance_growth_technology_stocks',
        };
      },
    },
    aggressive_small_caps: {
      method: 'get',
      path: '/saved',
      makeParams: (input: ScreenerInput) =>
        buildParams(input, 'aggressive_small_caps'),
      transformResult: (raw: any) => {
        const quotes = extractQuotes(raw);
        return {
          stocks: quotes.map(transformQuote),
          count: quotes.length,
          source: 'yahoo_finance_aggressive_small_caps',
        };
      },
    },
    undervalued_growth_stocks: {
      method: 'get',
      path: '/saved',
      makeParams: (input: ScreenerInput) =>
        buildParams(input, 'undervalued_growth_stocks'),
      transformResult: (raw: any) => {
        const quotes = extractQuotes(raw);
        return {
          stocks: quotes.map(transformQuote),
          count: quotes.length,
          source: 'yahoo_finance_undervalued_growth_stocks',
        };
      },
    },
  },
};
