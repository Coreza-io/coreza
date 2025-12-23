import { GatewayConfig } from '../types';
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
  preConnect: async (creds) => preConnectSchwab(creds),
  makeAuthMessage: (creds) => buildSchwabAuthMessage(creds),
  makeSubscribeMessage: (symbols) => buildSchwabSubscribeMessage(symbols),
  makeUnsubscribeMessage: (symbols) => buildSchwabUnsubscribeMessage(symbols),
  parseMessage: (buffer) => parseSchwabMessage(buffer),
  identifyMessageType: (msg) => identifySchwabMessageType(msg),
  shouldPublish: (msg) => shouldPublishSchwabMessage(msg),
  normalize: (msg) => normalizeSchwabMessage(msg),
  reconnectDelay: 2000,
  maxReconnectAttempts: 5,
  requiresPreConnect: true,
};
