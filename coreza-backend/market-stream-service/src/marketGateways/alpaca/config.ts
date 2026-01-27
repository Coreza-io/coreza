import { GatewayConfig } from '../types';
import {
  buildAlpacaAuthMessage,
  buildAlpacaSubscribeMessage,
  buildAlpacaUnsubscribeMessage,
  getAlpacaWsUrl,
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
  wsUrl: (creds, source) => getAlpacaWsUrl(creds, source),
  makeAuthMessage: (creds) => buildAlpacaAuthMessage(creds),
  isAuthSuccess: (msg) => isAlpacaAuthSuccess(msg),
  isAuthError: (msg) => isAlpacaAuthError(msg),
  handleControlMessage: (msg, logger, source) => handleAlpacaControlMessage(msg, logger, source),
  makeSubscribeMessage: (streamNames, source) => buildAlpacaSubscribeMessage(streamNames, source),
  makeUnsubscribeMessage: (streamNames, source) => buildAlpacaUnsubscribeMessage(streamNames, source),
  parseMessage: (buffer) => parseAlpacaMessage(buffer),
  identifyMessageType: (msg) => identifyAlpacaMessageType(msg),
  shouldPublish: (msg, source) => shouldPublishAlpacaMessage(msg, source),
  normalize: (msg, source) => normalizeAlpacaMessage(msg, source),
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
};
