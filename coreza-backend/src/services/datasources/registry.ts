/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
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
