import { GatewayConfig } from '../types';
import {
  buildDhanSubscribeMessage,
  buildDhanUnsubscribeMessage,
  identifyDhanMessageType,
  normalizeDhanMessage,
  parseDhanMessage,
  shouldPublishDhanMessage,
} from './helpers';

export const dhanGatewayConfig: GatewayConfig<'dhan'> = {
  id: 'dhan',
  wsUrl: (creds) =>
    `wss://api-feed.dhan.co?version=2&token=${creds.api_key}&clientId=${creds.client_id}&authType=2`,
  makeAuthMessage: undefined,
  makeSubscribeMessage: (symbols) => buildDhanSubscribeMessage(symbols),
  makeUnsubscribeMessage: (symbols) => buildDhanUnsubscribeMessage(symbols),
  parseMessage: (buffer) => parseDhanMessage(buffer),
  identifyMessageType: (msg) => identifyDhanMessageType(msg),
  shouldPublish: (msg) => shouldPublishDhanMessage(msg),
  normalize: (msg) => normalizeDhanMessage(msg),
  reconnectDelay: 2000,
  maxReconnectAttempts: 5,
  isBinary: true,
};
