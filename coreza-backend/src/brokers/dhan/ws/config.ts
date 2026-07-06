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
  isDhanFeedDisconnectMessage,
  describeDhanFeedDisconnect,
  isFatalDhanControlMessage,
} from './helpers';

export const dhanGatewayConfig: GatewayConfig<'dhan'> = {
  id: 'dhan',
  wsUrl: (creds, source) => getDhanWsUrl(creds, source),
  makeAuthMessage: (creds, source) => buildDhanAuthMessage(creds, source),
  authCompletesOnSend: (source) => source === 'dhan_trading',
  makeSubscribeMessage: (streamNames, _types, source) => buildDhanSubscribeMessage(streamNames, source),
  makeUnsubscribeMessage: (streamNames, _types, source) => buildDhanUnsubscribeMessage(streamNames, source),
  parseMessage: (buffer, source, isBinary) => parseDhanMessage(buffer, source, isBinary),
  identifyMessageType: (msg) => identifyDhanMessageType(msg),
  shouldPublish: (msg, source) => shouldPublishDhanMessage(msg, source),
  handleControlMessage: (msg, logger, source) => {
    if (!isDhanFeedDisconnectMessage(msg)) return;
    logger.error(
      { source, msg },
      `Dhan feed disconnect: ${describeDhanFeedDisconnect(msg, source)}`,
    );
  },
  isFatalControlMessage: (msg) => isFatalDhanControlMessage(msg),
  normalize: (msg, source) => normalizeDhanMessage(msg, source),
  reconnectDelay: 5000,
  maxReconnectDelay: 30000,
  reconnectJitter: 1000,
  maxReconnectAttempts: 5,
  reconnectResetAfterMs: 60_000,
  isBinary: () => false,
};
