import { GatewayConfig } from '../types';
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

export const dhanGatewayConfig: GatewayConfig = {
  id: 'dhan',
  wsUrl: (creds, source) => getDhanWsUrl(creds, source),
  makeAuthMessage: (creds, source) => buildDhanAuthMessage(creds, source),
  authCompletesOnSend: (source) => source === 'dhan_trading',
  makeSubscribeMessage: (streamNames, source) => buildDhanSubscribeMessage(streamNames, source),
  makeUnsubscribeMessage: (streamNames, source) => buildDhanUnsubscribeMessage(streamNames, source),
  parseMessage: (buffer, source) => parseDhanMessage(buffer, source),
  identifyMessageType: (msg) => identifyDhanMessageType(msg),
  shouldPublish: (msg, source) => shouldPublishDhanMessage(msg, source),
  normalize: (msg, source) => normalizeDhanMessage(msg, source),
  reconnectDelay: 2000,
  maxReconnectAttempts: 5,
  isBinary: () => false,
};
