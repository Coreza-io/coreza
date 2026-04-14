import { GatewayConfig } from "../types";
import {
  buildBinanceAuthMessage,
  buildBinanceKeepaliveMessage,
  buildBinancePostAuthMessage,
  buildBinanceSubscribeMessage,
  buildBinanceUnsubscribeMessage,
  getBinanceWsUrl,
  handleBinanceControlMessage,
  identifyBinanceMessageType,
  isBinancePostAuthSuccess,
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
  postAuthHook: (ws, creds, source, _logger) => {
    const msg = buildBinancePostAuthMessage(creds, source);
    if (msg) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  },
  isPostAuthSuccess: (msg, source) => isBinancePostAuthSuccess(msg, source),
  makeTradingKeepaliveMessage: (creds, source) =>
    buildBinanceKeepaliveMessage(creds, source),
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
