import { GatewayConfig } from '../types';
import { resolveDhanEnvironment, getDhanMarketWsUrl, getDhanOrderUpdateWsUrl } from './environment';
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

export const dhanGatewayConfig: GatewayConfig = {
  id: 'dhan',
  displayName: 'Dhan',
  validateCredentials: (creds, environment, source) => {
    if (resolveDhanEnvironment(creds) !== environment) throw Object.assign(new Error('The selected environment does not match the saved Dhan credential.'), { code: 'DHAN_ENVIRONMENT_MISMATCH' });
    if (!/^\d+$/.test(String(creds.client_id ?? '')) || !(creds.api_key ?? creds.access_token)) throw Object.assign(new Error('Reconnect Dhan with a numeric Client ID and Access Token.'), { code: 'DHAN_CREDENTIAL_INVALID' });
    if (source.endsWith('_trading')) getDhanOrderUpdateWsUrl(environment as 'live' | 'sandbox');
    else getDhanMarketWsUrl(environment as 'live' | 'sandbox');
  },
  subscriptionRequired: source => !source.endsWith('_trading'),
  decodeFailure: message => ({ code: String(message?.reasonCode ?? message?.code ?? 'PROVIDER_REJECTED'),
    message: typeof message?.reasonText === 'string' ? message.reasonText : 'Dhan rejected the stream request.' }),
  startupObservationMs: 2000,
  wsUrl: (creds, source) => getDhanWsUrl(creds, source),
  makeAuthMessage: (creds, source) => buildDhanAuthMessage(creds, source),
  authCompletesOnSend: (source) => source === 'dhan_trading',
  makeSubscribeMessage: (streamNames, source) => buildDhanSubscribeMessage(streamNames, source),
  makeUnsubscribeMessage: (streamNames, source) => buildDhanUnsubscribeMessage(streamNames, source),
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
