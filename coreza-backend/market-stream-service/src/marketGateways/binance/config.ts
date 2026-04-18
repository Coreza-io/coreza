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
      if (source !== "binance_trading") {
        _logger.error({ source, method: msg.method }, "Dropped trading payload on Binance market socket");
        return false;
      }
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
  requiresPreConnect: (source, creds) =>
    source === "binance_trading" &&
    String(creds?.marketType || "").toLowerCase() === "futures",
  preConnect: (creds, source) => preConnectBinance(creds, source),
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
};
