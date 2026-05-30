import { GatewayConfig } from '../types';
import type { OAuthRefreshProviderConfig } from '../../utils/oauthTokenManager';
import {
  buildSchwabAuthMessage,
  buildSchwabSubscribeMessage,
  buildSchwabUnsubscribeMessage,
  identifySchwabMessageType,
  normalizeSchwabMessage,
  parseSchwabMessage,
  preConnectSchwab,
  shouldPublishSchwabMessage,
} from './helpers';

export const schwabOAuthRefreshConfig: OAuthRefreshProviderConfig = {
  provider: 'schwab',
  tokenUrl: 'https://api.schwabapi.com/v1/oauth/token',
  clientIdField: 'app_key',
  clientSecretField: 'app_secret',
  refreshTokenLifetimeSeconds: 7 * 24 * 60 * 60,
};

export const schwabGatewayConfig: GatewayConfig = {
  id: 'schwab',
  wsUrl: (creds, _source) => creds.streamerSocketUrl,
  preConnect: async (creds, context) =>
    preConnectSchwab(creds, context, schwabOAuthRefreshConfig),
  makeAuthMessage: (creds) => buildSchwabAuthMessage(creds),
  makeSubscribeMessage: (streamNames, _source) => buildSchwabSubscribeMessage(streamNames),
  makeUnsubscribeMessage: (streamNames, _source) => buildSchwabUnsubscribeMessage(streamNames),
  parseMessage: (buffer) => parseSchwabMessage(buffer),
  identifyMessageType: (msg) => identifySchwabMessageType(msg),
  shouldPublish: (msg, _source) => shouldPublishSchwabMessage(msg),
  normalize: (msg, _source) => normalizeSchwabMessage(msg),
  reconnectDelay: 2000,
  maxReconnectAttempts: 5,
  requiresPreConnect: true,
};
