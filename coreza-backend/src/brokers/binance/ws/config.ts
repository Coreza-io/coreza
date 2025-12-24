import { GatewayConfig } from '../../gatewayTypes';
import {
  buildBinanceSubscribeMessage,
  buildBinanceUnsubscribeMessage,
  identifyBinanceMessageType,
  normalizeBinanceMessage,
  parseBinanceMessage,
  shouldPublishBinanceMessage,
} from './helpers';

export const binanceGatewayConfig: GatewayConfig<'binance'> = {
  id: 'binance',
  wsUrl: 'wss://stream.binance.com:9443/ws',
  makeSubscribeMessage: (symbols, types) => buildBinanceSubscribeMessage(symbols, types),
  makeUnsubscribeMessage: (symbols, types) => buildBinanceUnsubscribeMessage(symbols, types),
  parseMessage: (buffer) => parseBinanceMessage(buffer),
  identifyMessageType: (msg) => identifyBinanceMessageType(msg),
  shouldPublish: (msg) => shouldPublishBinanceMessage(msg),
  normalize: (msg) => normalizeBinanceMessage(msg),
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
};
