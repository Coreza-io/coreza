import { GatewayConfig } from '../types';
import {
  buildAlpacaNewsAuthMessage,
  buildAlpacaNewsSubscribeMessage,
  buildAlpacaNewsUnsubscribeMessage,
  handleAlpacaNewsControlMessage,
  identifyAlpacaNewsMessageType,
  isAlpacaNewsAuthError,
  isAlpacaNewsAuthSuccess,
  normalizeAlpacaNewsMessage,
  parseAlpacaNewsMessage,
  shouldPublishAlpacaNewsMessage,
} from './helpers';

export const alpacaNewsGatewayConfig: GatewayConfig = {
  id: 'alpaca_news',
  wsUrl: 'wss://stream.data.alpaca.markets/v1beta1/news',
  makeAuthMessage: (creds) => buildAlpacaNewsAuthMessage(creds),
  isAuthSuccess: (msg) => isAlpacaNewsAuthSuccess(msg),
  isAuthError: (msg) => isAlpacaNewsAuthError(msg),
  handleControlMessage: (msg, logger) => handleAlpacaNewsControlMessage(msg, logger),
  makeSubscribeMessage: (symbols) => buildAlpacaNewsSubscribeMessage(symbols),
  makeUnsubscribeMessage: (symbols) => buildAlpacaNewsUnsubscribeMessage(symbols),
  parseMessage: (buffer) => parseAlpacaNewsMessage(buffer),
  identifyMessageType: (msg) => identifyAlpacaNewsMessageType(msg),
  shouldPublish: (msg) => shouldPublishAlpacaNewsMessage(msg),
  normalize: (msg) => normalizeAlpacaNewsMessage(msg),
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
};
