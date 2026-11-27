import { BrokerConfig } from '../../types';
import { alpacaOperations } from './operations';
import { alpacaMarketDataContract, validateAlpacaMarketData } from '../marketDataContract';
import { resolveAlpacaInventoryQuantity } from '../portfolioHelpers';
import { ALPACA_STOCK_TIMEZONE, alpacaTradingBaseUrl } from '../helpers';

export const alpacaConfig: BrokerConfig = {
  authType: 'api_key',
  toolContract: alpacaMarketDataContract,
  normalizeInput: input => alpacaMarketDataContract.supports(input.operation) ? validateAlpacaMarketData(input) : input,
  baseUrl: (creds: any, input?: any) => {
    if (input?.operation === 'get_candle' || input?.operation === 'get_latest_bar' || input?.operation === 'fetch_news') {
      return 'https://data.alpaca.markets';
    }
    return alpacaTradingBaseUrl(input?.environment);
  },
  makeAuthHeaders: (creds: any) => ({
    'APCA-API-KEY-ID': creds.api_key,
    'APCA-API-SECRET-KEY': creds.secret_key,
  }),
  operations: alpacaOperations,
  historicalCandles: { timezone: assetType => assetType === 'crypto' ? 'UTC' : ALPACA_STOCK_TIMEZONE },
  resolvePortfolioInventoryQuantity: resolveAlpacaInventoryQuantity,
};
