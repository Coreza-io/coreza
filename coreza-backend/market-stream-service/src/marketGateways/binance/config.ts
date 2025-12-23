import { GatewayConfig } from '../types';
import {
  buildBinanceSubscribeMessage,
  buildBinanceUnsubscribeMessage,
  handleBinanceControlMessage,
  identifyBinanceMessageType,
  normalizeBinanceMessage,
  parseBinanceMessage,
  shouldPublishBinanceMessage,
} from './helpers';

export const binanceGatewayConfig: GatewayConfig = {
  id: 'binance',
  wsUrl: (creds) => {
    const isTestnet = creds.environment === 'testnet';
    const assetType = creds.asset_type || 'spot';

    if (assetType === 'futures') {
      return isTestnet ? 'wss://stream.testnet.binancefuture.com/ws' : 'wss://fstream.binance.com/ws';
    }

    return isTestnet ? 'wss://stream.testnet.binance.vision/ws' : 'wss://stream.binance.com:9443/ws';
  },
  makeSubscribeMessage: (symbols, types) => buildBinanceSubscribeMessage(symbols, types),
  makeUnsubscribeMessage: (symbols, types) => buildBinanceUnsubscribeMessage(symbols, types),
  parseMessage: (buffer) => parseBinanceMessage(buffer),
  identifyMessageType: (msg) => identifyBinanceMessageType(msg),
  shouldPublish: (msg) => shouldPublishBinanceMessage(msg),
  handleControlMessage: (msg, logger) => handleBinanceControlMessage(msg, logger),
  normalize: (msg) => normalizeBinanceMessage(msg),
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
};
