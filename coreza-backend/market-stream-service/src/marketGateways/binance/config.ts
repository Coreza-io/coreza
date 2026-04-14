import { GatewayConfig } from "../types";
import {
  buildBinanceAuthMessage,
  buildBinanceSubscribeMessage,
  buildBinanceUnsubscribeMessage,
  getBinanceWsUrl,
  handleBinanceControlMessage,
  identifyBinanceMessageType,
  normalizeBinanceMessage,
  parseBinanceMessage,
  preConnectBinance,
  shouldPublishBinanceMessage,
  isBinanceAuthSuccess,
  isBinanceAuthError,
} from "./helpers";

export const binanceGatewayConfig: GatewayConfig = {
  id: "binance",
  wsUrl: (creds, source) => getBinanceWsUrl(creds, source),
  makeAuthMessage: (creds, source) => buildBinanceAuthMessage(creds, source),
  isAuthSuccess: (msg, source) => isBinanceAuthSuccess(msg, source),
  isAuthError: (msg, source) => isBinanceAuthError(msg, source),
  makeSubscribeMessage: (stream, source) =>
    buildBinanceSubscribeMessage(stream, source),
  makeUnsubscribeMessage: (stream, source) =>
    buildBinanceUnsubscribeMessage(stream, source),
  parseMessage: (buffer) => parseBinanceMessage(buffer),
  identifyMessageType: (msg) => identifyBinanceMessageType(msg),
  shouldPublish: (msg, source) => shouldPublishBinanceMessage(msg, source),
  handleControlMessage: (msg, logger, source) =>
    handleBinanceControlMessage(msg, logger, source),
  normalize: (msg, source) => normalizeBinanceMessage(msg, source),
  requiresPreConnect: (source, creds) => false,
  preConnect: (creds, _source) => preConnectBinance(creds),
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
};
