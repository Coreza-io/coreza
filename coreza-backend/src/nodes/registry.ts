/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

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