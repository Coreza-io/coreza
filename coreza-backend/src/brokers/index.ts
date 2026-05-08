import { alpacaConfig } from './alpaca/http/config';
import { alpacaGatewayConfig } from './alpaca/ws/config';
import { alpacaNewsGatewayConfig } from './alpacaNews/ws/config';
import { binanceConfig } from './binance/http/config';
import { binanceGatewayConfig } from './binance/ws/config';
import { dhanConfig } from './dhan/http/config';
import { dhanGatewayConfig } from './dhan/ws/config';
import { schwabConfig } from './schwab/http/config';
import { schwabGatewayConfig } from './schwab/ws/config';
import { GatewayConfig } from './gatewayTypes';
import { BrokerConfig } from './types';

// Import and register capabilities
import { registerBrokerCapabilities } from './capabilities';
import { alpacaCapabilities } from './alpaca/capabilities';
import { binanceCapabilities } from './binance/capabilities';
import { dhanCapabilities } from './dhan/capabilities';
import { schwabCapabilities } from './schwab/capabilities';

// Register all broker capabilities at module load
registerBrokerCapabilities(alpacaCapabilities);
registerBrokerCapabilities(binanceCapabilities);
registerBrokerCapabilities(dhanCapabilities);
registerBrokerCapabilities(schwabCapabilities);

export const BROKER_CONFIGS: Record<string, BrokerConfig> = {
  alpaca: alpacaConfig,
  dhan: dhanConfig,
  schwab: schwabConfig,
  binance: binanceConfig,
};

export function registerBroker(name: string, config: BrokerConfig) {
  BROKER_CONFIGS[name] = config;
}

export function isSupportedBroker(broker: string): boolean {
  return broker.toLowerCase() in BROKER_CONFIGS;
}

export function getBrokerConfig(broker: string): BrokerConfig | undefined {
  return BROKER_CONFIGS[broker.toLowerCase()];
}

export function getAllSupportedBrokers(): string[] {
  return Object.keys(BROKER_CONFIGS);
}

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
export * from './gatewayTypes';
export * from './capabilities';
