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

type Environment = 'live' | 'testnet';
type AssetType = 'spot' | 'futures';

const getBaseUrl = (environment: Environment = 'live', assetType: AssetType = 'spot') => {
  const isTestnet = environment === 'testnet';

  if (assetType === 'futures') {
    return isTestnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com';
  }

  return isTestnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
};

const mapTicker = (ticker: any) => ({
  symbol: ticker.symbol,
  price: parseFloat(ticker.lastPrice),
  priceChange: parseFloat(ticker.priceChange),
  priceChangePercent: parseFloat(ticker.priceChangePercent),
  volume: parseFloat(ticker.volume),
  quoteVolume: parseFloat(ticker.quoteVolume),
  highPrice: parseFloat(ticker.highPrice),
  lowPrice: parseFloat(ticker.lowPrice),
});

export const binanceScreenerConfig: ScreenerConfig = {
  baseUrl: (_creds: any, input?: ScreenerInput) => {
    const environment = (input?.environment as Environment) || 'testnet';
    const assetType = (input?.asset_type as AssetType) || 'spot';

    return getBaseUrl(environment, assetType);
  },

  makeAuthHeaders: (creds: any) => ({
    'X-MBX-APIKEY': creds?.api_key || '',
  }),

  ops: {
    top_gainers: {
      method: 'get',
      path: (input: ScreenerInput) => {
        const assetType = (input.asset_type as AssetType) || 'spot';
        return assetType === 'futures' ? '/fapi/v1/ticker/24hr' : '/api/v3/ticker/24hr';
      },
      makeParams: () => ({}),
      transformResult: (raw: any[], input: ScreenerInput) => {
        const quoteAsset = input.quote_asset || 'USDT';
        const limit = Number(input.limit) || 10;
        const minChange = Number(input.min_price_change) || 0;

        const gainers = raw
          .filter(
            (t: any) => t.symbol.endsWith(quoteAsset) && parseFloat(t.priceChangePercent) > minChange
          )
          .map(mapTicker)
          .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
          .slice(0, limit);

        return {
          gainers,
          count: gainers.length,
          quote_asset: quoteAsset,
        };
      },
    },

    top_losers: {
      method: 'get',
      path: (input: ScreenerInput) => {
        const assetType = (input.asset_type as AssetType) || 'spot';
        return assetType === 'futures' ? '/fapi/v1/ticker/24hr' : '/api/v3/ticker/24hr';
      },
      makeParams: () => ({}),
      transformResult: (raw: any[], input: ScreenerInput) => {
        const quoteAsset = input.quote_asset || 'USDT';
        const limit = Number(input.limit) || 10;
        const minChange = Number(input.min_price_change) || 0;

        const losers = raw
          .filter(
            (t: any) => t.symbol.endsWith(quoteAsset) && parseFloat(t.priceChangePercent) < -minChange
          )
          .map(mapTicker)
          .sort((a, b) => a.priceChangePercent - b.priceChangePercent)
          .slice(0, limit);

        return {
          losers,
          count: losers.length,
          quote_asset: quoteAsset,
        };
      },
    },

    most_active: {
      method: 'get',
      path: (input: ScreenerInput) => {
        const assetType = (input.asset_type as AssetType) || 'spot';
        return assetType === 'futures' ? '/fapi/v1/ticker/24hr' : '/api/v3/ticker/24hr';
      },
      makeParams: () => ({}),
      transformResult: (raw: any[], input: ScreenerInput) => {
        const quoteAsset = input.quote_asset || 'USDT';
        const limit = Number(input.limit) || 10;
        const minVolume = Number(input.min_volume) || 0;

        const most_actives = raw
          .filter(
            (t: any) => t.symbol.endsWith(quoteAsset) && parseFloat(t.quoteVolume) >= minVolume
          )
          .map(mapTicker)
          .sort((a, b) => b.quoteVolume - a.quoteVolume)
          .slice(0, limit);

        return {
          most_actives,
          count: most_actives.length,
          quote_asset: quoteAsset,
        };
      },
    },

    new_listings: {
      method: 'get',
      path: (input: ScreenerInput) => {
        const assetType = (input.asset_type as AssetType) || 'spot';
        return assetType === 'futures' ? '/fapi/v1/exchangeInfo' : '/api/v3/exchangeInfo';
      },
      makeParams: () => ({}),
      transformResult: (raw: any, input: ScreenerInput) => {
        const quoteAsset = input.quote_asset || 'USDT';
        const limit = Number(input.limit) || 10;

        const new_listings = (raw.symbols || [])
          .filter((s: any) => s.status === 'TRADING' && s.quoteAsset === quoteAsset)
          .map((s: any) => ({
            symbol: s.symbol,
            baseAsset: s.baseAsset,
            quoteAsset: s.quoteAsset,
            status: s.status,
          }))
          .slice(-limit)
          .reverse();

        return {
          new_listings,
          count: new_listings.length,
          quote_asset: quoteAsset,
          note: 'Approximate - Binance does not provide listing dates',
        };
      },
    },
  },
};
