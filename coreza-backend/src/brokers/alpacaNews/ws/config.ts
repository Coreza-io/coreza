import { GatewayConfig } from '../../gatewayTypes';
import {
  buildAlpacaNewsAuthMessage,
  buildAlpacaNewsSubscribeMessage,
  buildAlpacaNewsUnsubscribeMessage,
  identifyAlpacaNewsMessageType,
  normalizeAlpacaNewsMessage,
  parseAlpacaNewsMessage,
  shouldPublishAlpacaNewsMessage,
} from './helpers';

export const alpacaNewsGatewayConfig: GatewayConfig<'alpaca_news'> = {
  id: 'alpaca_news',
  wsUrl: 'wss://stream.data.alpaca.markets/v1beta1/news',
  makeAuthMessage: (creds) => buildAlpacaNewsAuthMessage(creds),
  makeSubscribeMessage: (symbols) => buildAlpacaNewsSubscribeMessage(symbols),
  makeUnsubscribeMessage: (symbols) => buildAlpacaNewsUnsubscribeMessage(symbols),
  parseMessage: (buffer) => parseAlpacaNewsMessage(buffer),
  identifyMessageType: (msg) => identifyAlpacaNewsMessageType(msg),
  shouldPublish: (msg) => shouldPublishAlpacaNewsMessage(msg),
  normalize: (msg) => normalizeAlpacaNewsMessage(msg),
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
};
