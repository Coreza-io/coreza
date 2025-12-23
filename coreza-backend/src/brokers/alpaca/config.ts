import { BrokerConfig } from '../types';
import { alpacaOperations } from './operations';

export const alpacaConfig: BrokerConfig = {
  authType: 'api_key',
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
};
