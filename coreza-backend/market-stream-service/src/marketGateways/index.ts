import { alpacaGatewayConfig } from './alpaca/config';
import { alpacaNewsGatewayConfig } from './alpacaNews/config';
import { binanceGatewayConfig } from './binance/config';
import { dhanGatewayConfig } from './dhan/config';
import { schwabGatewayConfig } from './schwab/config';
import { GatewayConfig } from './types';

export const GATEWAY_CONFIGS: Record<string, GatewayConfig> = {
  alpaca: alpacaGatewayConfig,
  alpaca_news: alpacaNewsGatewayConfig,
  binance: binanceGatewayConfig,
  dhan: dhanGatewayConfig,
  schwab: schwabGatewayConfig,
};

export function registerGateway(name: string, config: GatewayConfig) {
  GATEWAY_CONFIGS[name] = config;
}

export type MarketSource = keyof typeof GATEWAY_CONFIGS;

// ============================================================
// Source Mapping: Maps frontend/control message source IDs to gateway sources
// ============================================================

export interface SourceMapping {
  credentialServiceType: string;
  gatewaySource: MarketSource;
}

export const SOURCE_MAPPING: Record<string, SourceMapping> = {
  alpaca_stream: { credentialServiceType: 'alpaca', gatewaySource: 'alpaca' },
  alpaca_news: { credentialServiceType: 'alpaca', gatewaySource: 'alpaca_news' },
  binance_stream: { credentialServiceType: 'binance', gatewaySource: 'binance' },
  dhan_stream: { credentialServiceType: 'dhan', gatewaySource: 'dhan' },
  schwab_stream: { credentialServiceType: 'schwab', gatewaySource: 'schwab' },
  alpaca: { credentialServiceType: 'alpaca', gatewaySource: 'alpaca' },
  binance: { credentialServiceType: 'binance', gatewaySource: 'binance' },
  dhan: { credentialServiceType: 'dhan', gatewaySource: 'dhan' },
  schwab: { credentialServiceType: 'schwab', gatewaySource: 'schwab' },
};

/**
 * Get source mapping for a given source ID.
 * Maps frontend/control message source IDs to credential service types and gateway sources.
 */
export function getSourceMapping(source: string): SourceMapping {
  return SOURCE_MAPPING[source] || {
    credentialServiceType: source,
    gatewaySource: source as MarketSource,
  };
}

export * from './types';
