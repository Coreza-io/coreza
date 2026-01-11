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

import fs from "fs";
import path from "path";
import { registerDataSource } from "./registry";
import { DataSourceService } from "./dataSourceService";

export function initializeDataSourceServices() {
  console.log("📊 Initializing data source services...");

  // Auto-discover and register config-based data sources from configs/ directory
  const configDir = path.join(__dirname, "configs");

  if (fs.existsSync(configDir)) {
    const configFiles = fs
      .readdirSync(configDir)
      .filter((f) => f.endsWith(".ts") || f.endsWith(".js"));

    for (const file of configFiles) {
      const serviceKey = file.replace(/\.(ts|js)$/, "");

      try {
        const configModule = require(path.join(configDir, file));
        const config =
          configModule.default || configModule[`${serviceKey}DataSourceConfig`];

        if (config?.ops) {
          registerDataSource(new DataSourceService(serviceKey, config));
          console.log(`  ✅ Registered data source: ${serviceKey}`);
        }
      } catch (error) {
        console.error(`  ❌ Failed to load data source config: ${file}`, error);
      }
    }
  }

  console.log("✅ All data source services initialized");
}

// Re-export for convenience
export { getDataSourceService, getAllRegisteredDataSources } from "./registry";
export { DataSourceInput, DataSourceResult, IDataSourceService } from "./types";
export { DataSourceService, DataSourceConfig, DataSourceOperation, HttpMethod } from "./dataSourceService";
