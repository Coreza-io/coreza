import { BrokerConfig } from '../../types';
import { validateDhanCredentials, validateDhanStreamCredentials } from '../credentialValidation';
import { getDhanRestBaseUrl, resolveDhanEnvironment } from '../environment';
import { dhanOperations } from './operations';

export const dhanConfig: BrokerConfig = {
  validateCredentials: validateDhanCredentials,
  validateStreamCredentials: validateDhanStreamCredentials,
  credentialValidationMessage: "Dhan credentials verified and saved. Requested stream feeds are checked separately at startup.",
  authType: 'api_key',
  baseUrl: (creds) => getDhanRestBaseUrl(resolveDhanEnvironment(creds)),
  makeAuthHeaders: (creds: any) => ({
    'access-token': creds.api_key,
    'Content-Type': 'application/json',
  }),
  operations: dhanOperations,
};
