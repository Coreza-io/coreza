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

export const schwabGatewayConfig: GatewayConfig = {
  id: 'schwab',
  wsUrl: (creds, _source) => creds.streamerSocketUrl,
  preConnect: async (creds) => preConnectSchwab(creds),
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
