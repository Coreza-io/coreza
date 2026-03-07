import { GatewayConfig } from "../types";
import {
  buildBinanceSubscribeMessage,
  buildBinanceUnsubscribeMessage,
  getBinanceWsUrl,
  handleBinanceControlMessage,
  identifyBinanceMessageType,
  normalizeBinanceMessage,
  parseBinanceMessage,
  preConnectBinance,
  shouldPublishBinanceMessage,
} from "./helpers";

export const binanceGatewayConfig: GatewayConfig = {
  id: "binance",
  wsUrl: (creds, source) => getBinanceWsUrl(creds, source),
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
  requiresPreConnect: (source) => source === "binance_trading",
  preConnect: (creds, _source) => preConnectBinance(creds),
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
};
