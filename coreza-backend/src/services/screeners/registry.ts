import { IScreenerService } from './types';

const registry = new Map<string, IScreenerService>();

export function registerScreener(service: IScreenerService) {
  const key = service.screenerKey.toLowerCase();
  if (registry.has(key)) {
    throw new Error(`Screener "${service.screenerKey}" already registered`);
  }
  registry.set(key, service);
  console.log(`📊 Registered screener service: ${service.screenerKey}`);
}

export function getScreenerService(key: string): IScreenerService | undefined {
  return registry.get(key.toLowerCase());
}

export function getAllRegisteredScreeners(): string[] {
  return Array.from(registry.keys());
}
