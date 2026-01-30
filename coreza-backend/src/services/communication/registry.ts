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

import { ICommunicationService, CommunicationConfig } from "./types";

const registry = new Map<string, ICommunicationService>();

export function registerCommunicationService(
  service: ICommunicationService
): void {
  if (registry.has(service.serviceKey)) {
    throw new Error(
      `Communication service "${service.serviceKey}" already registered.`
    );
  }
  registry.set(service.serviceKey, service);
  console.log(`📨 Registered communication service: ${service.serviceKey}`);
}

export function getCommunicationService(
  serviceKey: string
): ICommunicationService | undefined {
  return registry.get(serviceKey.toLowerCase());
}

export function getAllCommunicationServices(): string[] {
  return Array.from(registry.keys());
}

export function getCommunicationServiceConfig(
  serviceKey: string
): CommunicationConfig | undefined {
  return registry.get(serviceKey.toLowerCase())?.config;
}
