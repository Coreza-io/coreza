import { BrokerConfig } from '../../types';
import { getDhanRestBaseUrl, resolveDhanEnvironment } from '../environment';
import { dhanOperations } from './operations';

export const dhanConfig: BrokerConfig = {
  authType: 'api_key',
  baseUrl: (creds) => getDhanRestBaseUrl(resolveDhanEnvironment(creds)),
  makeAuthHeaders: (creds: any) => ({
    'access-token': creds.api_key,
    'Content-Type': 'application/json',
  }),
  operations: dhanOperations,
};
