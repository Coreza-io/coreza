import { GatewayConfig } from '../types';
import {
  buildDhanSubscribeMessage,
  buildDhanUnsubscribeMessage,
  identifyDhanMessageType,
  normalizeDhanMessage,
  parseDhanMessage,
  shouldPublishDhanMessage,
} from './helpers';

export const dhanGatewayConfig: GatewayConfig = {
  id: 'dhan',
  wsUrl: (creds, _source) =>
    `wss://api-feed.dhan.co?version=2&token=${creds.api_key}&clientId=${creds.client_id}&authType=2`,
  makeAuthMessage: undefined,
  makeSubscribeMessage: (symbols, _types, _options, _source) => buildDhanSubscribeMessage(symbols),
  makeUnsubscribeMessage: (symbols, _types, _options, _source) => buildDhanUnsubscribeMessage(symbols),
  parseMessage: (buffer) => parseDhanMessage(buffer),
  identifyMessageType: (msg) => identifyDhanMessageType(msg),
  shouldPublish: (msg, _source) => shouldPublishDhanMessage(msg),
  normalize: (msg, _source) => normalizeDhanMessage(msg),
  reconnectDelay: 2000,
  maxReconnectAttempts: 5,
  isBinary: true,
};
