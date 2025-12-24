import { GatewayConfig } from '../../gatewayTypes';
import {
  buildAlpacaAuthMessage,
  buildAlpacaSubscribeMessage,
  buildAlpacaUnsubscribeMessage,
  identifyAlpacaMessageType,
  normalizeAlpacaMessage,
  parseAlpacaMessage,
  shouldPublishAlpacaMessage,
} from '../helpers';

export const alpacaGatewayConfig: GatewayConfig<'alpaca'> = {
  id: 'alpaca',
  wsUrl: 'wss://stream.data.alpaca.markets/v2/iex',
  makeAuthMessage: (creds) => buildAlpacaAuthMessage(creds),
  makeSubscribeMessage: (symbols, types) => buildAlpacaSubscribeMessage(symbols, types),
  makeUnsubscribeMessage: (symbols, types) => buildAlpacaUnsubscribeMessage(symbols, types),
  parseMessage: (buffer) => parseAlpacaMessage(buffer),
  identifyMessageType: (msg) => identifyAlpacaMessageType(msg),
  shouldPublish: (msg) => shouldPublishAlpacaMessage(msg),
  normalize: (msg) => normalizeAlpacaMessage(msg),
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
};
