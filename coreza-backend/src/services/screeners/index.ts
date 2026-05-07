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
import { registerScreener } from "./registry";
import { ScreenerService } from "./screener";

export function initializeScreenerServices() {
  console.log("📊 Initializing screener services...");

  // 1. Auto-discover and register config-based screeners from configs/ directory
  const configDir = path.join(__dirname, "configs");

  if (fs.existsSync(configDir)) {
    const configFiles = fs
      .readdirSync(configDir)
      .filter((f) => f.endsWith(".ts") || f.endsWith(".js"));

    for (const file of configFiles) {
      const screenerKey = file.replace(/\.(ts|js)$/, "");

      try {
        const configModule = require(path.join(configDir, file));
        const config =
          configModule.default || configModule[`${screenerKey}ScreenerConfig`];

        if (config?.ops) {
          registerScreener(new ScreenerService(screenerKey, config));
          console.log(`  ✅ Registered screener: ${screenerKey}`);
        }
      } catch (error) {
        console.error(`  ❌ Failed to load screener config: ${file}`, error);
      }
    }
  }

  console.log("✅ All screener services initialized");
}

// Re-export for convenience
export { getScreenerService, getAllRegisteredScreeners } from "./registry";
export { ScreenerInput, ScreenerResult, IScreenerService } from "./types";
