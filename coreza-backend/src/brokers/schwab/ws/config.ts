import { GatewayConfig } from '../../gatewayTypes';
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

export const schwabGatewayConfig: GatewayConfig<'schwab'> = {
  id: 'schwab',
  wsUrl: (creds) => creds.streamerSocketUrl,
  preConnect: async (creds, context) => preConnectSchwab(creds, context),
  makeAuthMessage: (creds) => buildSchwabAuthMessage(creds),
  makeSubscribeMessage: (symbols, _types, source, creds) =>
    buildSchwabSubscribeMessage(
      symbols,
      typeof source === 'string' ? source : undefined,
      creds,
    ),
  makeUnsubscribeMessage: (symbols, _types, source, creds) =>
    buildSchwabUnsubscribeMessage(
      symbols,
      typeof source === 'string' ? source : undefined,
      creds,
    ),
  parseMessage: (buffer) => parseSchwabMessage(buffer),
  identifyMessageType: (msg) => identifySchwabMessageType(msg),
  shouldPublish: (msg) => shouldPublishSchwabMessage(msg),
  normalize: (msg) => normalizeSchwabMessage(msg),
  reconnectDelay: 2000,
  maxReconnectAttempts: 5,
  requiresPreConnect: true,
};
