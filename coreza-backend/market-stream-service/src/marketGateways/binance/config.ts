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
  wsUrl: (creds, _source) => {
    const isTestnet = creds.environment === 'testnet';
    const assetType = creds.asset_type || 'spot';

    if (assetType === 'futures') {
      return isTestnet ? 'wss://stream.testnet.binancefuture.com/ws' : 'wss://fstream.binance.com/ws';
    }

    return isTestnet ? 'wss://stream.testnet.binance.vision/ws' : 'wss://stream.binance.com:9443/ws';
  },
  makeSubscribeMessage: (symbols, types, options, _source) => buildBinanceSubscribeMessage(symbols, types, options),
  makeUnsubscribeMessage: (symbols, types, options, _source) => buildBinanceUnsubscribeMessage(symbols, types, options),
  parseMessage: (buffer) => parseBinanceMessage(buffer),
  identifyMessageType: (msg) => identifyBinanceMessageType(msg),
  shouldPublish: (msg, _source) => shouldPublishBinanceMessage(msg),
  handleControlMessage: (msg, logger, _source) => handleBinanceControlMessage(msg, logger),
  normalize: (msg, _source) => normalizeBinanceMessage(msg),
  reconnectDelay: 1000,
  maxReconnectAttempts: 5,
};
