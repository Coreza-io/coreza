import { BrokerConfig } from '../../types';
import { alpacaOperations } from './operations';
import { alpacaMarketDataContract, validateAlpacaMarketData } from '../marketDataContract';
import { resolveAlpacaInventoryQuantity } from '../portfolioHelpers';

export const alpacaConfig: BrokerConfig = {
  authType: 'api_key',
  toolContract: alpacaMarketDataContract,
  normalizeInput: input => alpacaMarketDataContract.supports(input.operation) ? validateAlpacaMarketData(input) : input,
  baseUrl: (creds: any, input?: any) => {
    if (input?.operation === 'get_candle' || input?.operation === 'get_latest_bar' || input?.operation === 'fetch_news') {
      return 'https://data.alpaca.markets';
    }
    return input?.environment === 'live'
      ? 'https://api.alpaca.markets'
      : 'https://paper-api.alpaca.markets';
  },
  makeAuthHeaders: (creds: any) => ({
    'APCA-API-KEY-ID': creds.api_key,
    'APCA-API-SECRET-KEY': creds.secret_key,
  }),
  operations: alpacaOperations,
  resolvePortfolioInventoryQuantity: resolveAlpacaInventoryQuantity,
};
