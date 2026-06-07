import { GatewayConfig } from '../../gatewayTypes';
import {
  buildDhanAuthMessage,
  buildDhanSubscribeMessage,
  buildDhanUnsubscribeMessage,
  getDhanWsUrl,
  identifyDhanMessageType,
  normalizeDhanMessage,
  parseDhanMessage,
  shouldPublishDhanMessage,
} from './helpers';

export const dhanGatewayConfig: GatewayConfig<'dhan'> = {
  id: 'dhan',
  wsUrl: (creds, source) => getDhanWsUrl(creds, source),
  makeAuthMessage: (creds, source) => buildDhanAuthMessage(creds, source),
  makeSubscribeMessage: (symbols, _types, source) =>
    buildDhanSubscribeMessage(symbols, source),
  makeUnsubscribeMessage: (symbols, _types, source) =>
    buildDhanUnsubscribeMessage(symbols, source),
  parseMessage: (buffer, source) => parseDhanMessage(buffer, source),
  identifyMessageType: (msg) => identifyDhanMessageType(msg),
  shouldPublish: (msg, source) => shouldPublishDhanMessage(msg, source),
  normalize: (msg, source) => normalizeDhanMessage(msg, source),
  reconnectDelay: 2000,
  maxReconnectAttempts: 5,
  isBinary: () => false,
};
