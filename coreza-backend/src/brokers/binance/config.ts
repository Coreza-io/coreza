import { BrokerConfig } from '../types';
import { binanceOperations } from './operations';

export const binanceConfig: BrokerConfig = {
  authType: 'api_key',
  baseUrl: (creds: any, input?: any) => {
    if (input?.asset_type === 'futures') {
      return input?.environment === 'live'
        ? 'https://fapi.binance.com'
        : 'https://testnet.binancefuture.com';
    }
    return input?.environment === 'live'
      ? 'https://api.binance.com'
      : 'https://testnet.binance.vision';
  },
  makeAuthHeaders: (creds: any) => ({
    'X-MBX-APIKEY': creds.api_key,
  }),
  operations: binanceOperations,
};
