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

export const SOURCE_MAPPING: Record<string, SourceMapping> = Object.keys(
  GATEWAY_CONFIGS
).reduce((mapping, key) => {
  const base = key.split('_')[0];
  const gatewaySource = key as MarketSource;

  mapping[key] = { credentialServiceType: base, gatewaySource };

  if (key === base) {
    mapping[`${base}_stream`] = { credentialServiceType: base, gatewaySource };
  }

  return mapping;
}, {} as Record<string, SourceMapping>);

/**
 * Get source mapping for a given source ID.
 * Maps frontend/control message source IDs to credential service types and gateway sources.
 */
export function getSourceMapping(source: string): SourceMapping {
  return (
    SOURCE_MAPPING[source] || {
      credentialServiceType: source,
      gatewaySource: source as MarketSource,
    }
  );
}

export * from './types';
