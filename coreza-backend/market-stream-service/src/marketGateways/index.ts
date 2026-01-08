import { alpacaGatewayConfig } from './alpaca/config';
import { binanceGatewayConfig } from './binance/config';
import { dhanGatewayConfig } from './dhan/config';
import { schwabGatewayConfig } from './schwab/config';
import { GatewayConfig } from './types';

// Gateway configs - one per broker (source param differentiates sub-types like news vs stream)
export const GATEWAY_CONFIGS: Record<string, GatewayConfig> = {
  alpaca: alpacaGatewayConfig,
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

// Maps source_id (e.g., 'alpaca_news', 'alpaca_market') to gateway config
// The original source_id is passed through to config functions for behavior routing
// Pattern: {subCategory}_{dataType} (e.g., alpaca_market, alpaca_news, binance_market)
export const SOURCE_MAPPING: Record<string, SourceMapping> = {
  // Alpaca - both use same gateway, source param differentiates behavior (market vs news)
  alpaca_market: { credentialServiceType: 'alpaca', gatewaySource: 'alpaca' },
  alpaca_news: { credentialServiceType: 'alpaca', gatewaySource: 'alpaca' },
  alpaca_stream: { credentialServiceType: 'alpaca', gatewaySource: 'alpaca' }, // Legacy support
  alpaca: { credentialServiceType: 'alpaca', gatewaySource: 'alpaca' },

  // Binance
  binance_market: { credentialServiceType: 'binance', gatewaySource: 'binance' },
  binance_stream: { credentialServiceType: 'binance', gatewaySource: 'binance' }, // Legacy support
  binance: { credentialServiceType: 'binance', gatewaySource: 'binance' },

  // Dhan
  dhan_market: { credentialServiceType: 'dhan', gatewaySource: 'dhan' },
  dhan_stream: { credentialServiceType: 'dhan', gatewaySource: 'dhan' }, // Legacy support
  dhan: { credentialServiceType: 'dhan', gatewaySource: 'dhan' },

  // Schwab
  schwab_market: { credentialServiceType: 'schwab', gatewaySource: 'schwab' },
  schwab_stream: { credentialServiceType: 'schwab', gatewaySource: 'schwab' }, // Legacy support
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
