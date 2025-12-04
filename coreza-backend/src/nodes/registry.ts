/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
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