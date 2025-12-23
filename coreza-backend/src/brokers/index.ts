import { alpacaConfig } from './alpaca/config';
import { binanceConfig } from './binance/config';
import { dhanConfig } from './dhan/config';
import { schwabConfig } from './schwab/config';
import { BrokerConfig } from './types';

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

export * from './types';
