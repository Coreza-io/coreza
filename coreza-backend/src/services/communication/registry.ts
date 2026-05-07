/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
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
