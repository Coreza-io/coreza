/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { IScreenerService } from "./types";

const registry = new Map<string, IScreenerService>();

export function registerScreener(service: IScreenerService) {
  if (registry.has(service.screenerKey)) {
    throw new Error(`Screener "${service.screenerKey}" already registered.`);
  }

  registry.set(service.screenerKey, service);
  console.log(`📊 Registered screener service: ${service.screenerKey}`);
}

export function getScreenerService(
  screenerKey: string
): IScreenerService | undefined {
  return registry.get(screenerKey);
}

export function getAllRegisteredScreeners(): string[] {
  return Array.from(registry.keys());
}
