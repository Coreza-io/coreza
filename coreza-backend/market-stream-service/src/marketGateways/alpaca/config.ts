import { GatewayConfig } from '../types';
import {
  buildAlpacaAuthMessage,
  buildAlpacaSubscribeMessage,
  buildAlpacaUnsubscribeMessage,
  handleAlpacaControlMessage,
  identifyAlpacaMessageType,
  isAlpacaAuthError,
  isAlpacaAuthSuccess,
  normalizeAlpacaMessage,
  parseAlpacaMessage,
  shouldPublishAlpacaMessage,
} from './helpers';

export const alpacaGatewayConfig: GatewayConfig = {
  id: 'alpaca',
  wsUrl: (creds) => {
    const feed = creds.feed || 'iex';
    return `wss://stream.data.alpaca.markets/v2/${feed}`;
  },
  makeAuthMessage: (creds) => buildAlpacaAuthMessage(creds),
  isAuthSuccess: (msg) => isAlpacaAuthSuccess(msg),
  isAuthError: (msg) => isAlpacaAuthError(msg),
  handleControlMessage: (msg, logger) => handleAlpacaControlMessage(msg, logger),
  makeSubscribeMessage: (symbols, types) => buildAlpacaSubscribeMessage(symbols, types),
  makeUnsubscribeMessage: (symbols, types) => buildAlpacaUnsubscribeMessage(symbols, types),
  parseMessage: (buffer) => parseAlpacaMessage(buffer),
  identifyMessageType: (msg) => identifyAlpacaMessageType(msg),
  shouldPublish: (msg) => shouldPublishAlpacaMessage(msg),
  normalize: (msg) => normalizeAlpacaMessage(msg),
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
};
