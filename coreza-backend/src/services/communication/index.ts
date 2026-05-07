/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { CommunicationService } from "./communicationService";
import {
  registerCommunicationService,
  getCommunicationService,
  getAllCommunicationServices,
  getCommunicationServiceConfig,
} from "./registry";

// Import configs
import { telegramConfig } from "./configs/telegram";
import { whatsappConfig } from "./configs/whatsapp";
import { gmailConfig } from "./configs/gmail";

// All configs to register
const configs = [telegramConfig, whatsappConfig, gmailConfig];

let initialized = false;

export function initializeCommunicationServices(): void {
  if (initialized) {
    console.log("📨 Communication services already initialized");
    return;
  }

  console.log("📨 Initializing communication services...");

  for (const config of configs) {
    const service = new CommunicationService(config.serviceKey, config);
    registerCommunicationService(service);
  }

  initialized = true;
  console.log(
    `📨 Initialized ${configs.length} communication services: ${configs.map((c) => c.serviceKey).join(", ")}`
  );
}

// Re-export everything
export {
  getCommunicationService,
  getAllCommunicationServices,
  getCommunicationServiceConfig,
};
export * from "./types";
