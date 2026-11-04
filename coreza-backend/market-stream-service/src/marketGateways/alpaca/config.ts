import { GatewayConfig } from "../types";
import {
  describeAlpacaStartupError,
  isAlpacaSubscriptionConfirmed,
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
} from "./helpers";

export const alpacaGatewayConfig: GatewayConfig = {
  id: "alpaca",
  connectionCredentialFields: ["api_key", "secret_key"],
  normalizeConnectionOptions: (source, options) => ({
    // News, trading and crypto have dedicated endpoints rather than stock feeds.
    feed: ["alpaca_news", "alpaca_trading", "alpaca_crypto"].includes(source)
      ? undefined : options.feed ?? "iex",
  }),
  subscriptionReadiness: () => ({ requiresSubscriptionMessage: true, confirmation: "acknowledgment" }),
  describeStartupError: describeAlpacaStartupError,
  makeSubscriptionExpectation: (stream, _payload, source) => buildAlpacaSubscribeMessage([stream], source),
  isSubscriptionConfirmed: isAlpacaSubscriptionConfirmed,
  wsUrl: (creds, source) => getAlpacaWsUrl(creds, source),
  makeAuthMessage: (creds, source) => buildAlpacaAuthMessage(creds, source),
  isAuthSuccess: (msg, source) => isAlpacaAuthSuccess(msg, source),
  isAuthError: (msg, source) => isAlpacaAuthError(msg, source),
  handleControlMessage: (msg, logger, source) =>
    handleAlpacaControlMessage(msg, logger, source),
  makeSubscribeMessage: (streamNames, source) =>
    buildAlpacaSubscribeMessage(streamNames, source),
  makeUnsubscribeMessage: (streamNames, source) =>
    buildAlpacaUnsubscribeMessage(streamNames, source),
  parseMessage: (buffer) => parseAlpacaMessage(buffer),
  identifyMessageType: (msg) => identifyAlpacaMessageType(msg),
  shouldPublish: (msg, source) => shouldPublishAlpacaMessage(msg, source),
  normalize: (msg, source) => normalizeAlpacaMessage(msg, source),
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
};
