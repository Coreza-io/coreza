/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import fs from "fs";
import path from "path";
import { StorageService } from "./storageService";
import { registerStorageService, getStorageService, getAllRegisteredStorageServices } from "./registry";

export function initializeStorageServices(): void {
  console.log("📦 Initializing storage services...");

  const configDir = path.join(__dirname, "configs");
  if (!fs.existsSync(configDir)) {
    console.warn("  ⚠️ Storage configs directory not found");
    return;
  }

  // Filter for compiled JS files in production or TS files in development
  const ext = __filename.endsWith(".js") ? ".js" : ".ts";
  const configFiles = fs.readdirSync(configDir).filter((f) => f.endsWith(ext) && !f.startsWith("index"));

  for (const file of configFiles) {
    try {
      const serviceKey = file.replace(/\.(ts|js)$/, "");
      const configModule = require(path.join(configDir, file));
      const config = configModule.default || configModule[`${serviceKey}Config`];

      if (config?.operations) {
        registerStorageService(new StorageService(serviceKey, config));
      }
    } catch (error) {
      console.error(`  ❌ Failed to load storage config ${file}:`, error);
    }
  }

  console.log(`📦 Initialized ${getAllRegisteredStorageServices().length} storage services`);
}

export { getStorageService, getAllRegisteredStorageServices };
export { StorageService } from "./storageService";
export type { IStorageService, StorageInput, StorageResult, StorageContext } from "./types";
