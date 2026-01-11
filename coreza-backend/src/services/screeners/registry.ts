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
