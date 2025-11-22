import { IBrokerService } from './types';

const registry = new Map<string, IBrokerService>();

export function registerBroker(service: IBrokerService) {
  if (registry.has(service.brokerKey.toLowerCase())) {
    throw new Error(`Broker "${service.brokerKey}" already registered`);
  }
  registry.set(service.brokerKey.toLowerCase(), service);
  console.log(`🔗 Registered broker service: ${service.brokerKey}`);
}

export function getBrokerService(key: string): IBrokerService | undefined {
  return registry.get(key.toLowerCase());
}

export function getAllRegisteredBrokers(): string[] {
  return Array.from(registry.keys());
}