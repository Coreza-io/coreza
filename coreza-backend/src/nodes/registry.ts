import { INodeExecutor } from './types';

const registry = new Map<string, INodeExecutor>();

export function registerNodeExecutor(executor: INodeExecutor) {
  if (registry.has(executor.category)) {
    throw new Error(`Node executor for "${executor.category}" already registered.`);
  }
  registry.set(executor.category, executor);
  console.log(`🔧 Registered node executor: ${executor.category}`);
}

export function getNodeExecutor(category: string): INodeExecutor | undefined {
  return registry.get(category);
}

export function getAllRegisteredCategories(): string[] {
  return Array.from(registry.keys());
}