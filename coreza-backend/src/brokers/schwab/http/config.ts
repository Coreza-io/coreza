import { BrokerConfig } from '../../types';
import { schwabOperations } from './operations';

export const schwabConfig: BrokerConfig = {
  authType: 'oauth',
  baseUrl: (creds: any, input?: any) => {
    const marketDataOps = ['get_quotes', 'get_price_history'];
    if (input?.operation && marketDataOps.includes(input.operation)) {
      return 'https://api.schwabapi.com/marketdata/v1';
    }
    return 'https://api.schwabapi.com/trader/v1';
  },
  makeAuthHeaders: (creds: any) => ({
    Authorization: `Bearer ${creds.access_token}`,
  }),
  operations: schwabOperations,
};
