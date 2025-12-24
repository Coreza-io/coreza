import { BrokerConfig } from '../../types';
import { dhanOperations } from './operations';

export const dhanConfig: BrokerConfig = {
  authType: 'api_key',
  baseUrl: process.env.DHAN_API_BASE_URL || 'https://sandbox.dhan.co/v2',
  makeAuthHeaders: (creds: any) => ({
    'access-token': creds.api_key,
    'Content-Type': 'application/json',
  }),
  operations: dhanOperations,
};
