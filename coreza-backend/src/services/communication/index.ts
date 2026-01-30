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
