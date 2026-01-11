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

import { IDataSourceService } from "./types";

const registry = new Map<string, IDataSourceService>();

export function registerDataSource(service: IDataSourceService) {
  if (registry.has(service.serviceKey)) {
    throw new Error(`Data source "${service.serviceKey}" already registered.`);
  }

  registry.set(service.serviceKey, service);
  console.log(`📊 Registered data source service: ${service.serviceKey}`);
}

export function getDataSourceService(
  serviceKey: string
): IDataSourceService | undefined {
  return registry.get(serviceKey);
}

export function getAllRegisteredDataSources(): string[] {
  return Array.from(registry.keys());
}
