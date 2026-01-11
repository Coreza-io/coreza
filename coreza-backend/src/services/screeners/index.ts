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

import fs from 'fs';
import path from 'path';
import { ScreenerService, ScreenerConfig } from './ScreenerService';
import { IScreenerService } from './types';

const configCache = new Map<string, ScreenerConfig>();
const serviceCache = new Map<string, IScreenerService>();
let isLoaded = false;

function loadConfigs(): void {
  if (isLoaded) {
    return;
  }

  console.log('📊 Loading screener configs...');
  const configDir = path.join(__dirname, 'configs');

  if (fs.existsSync(configDir)) {
    const configFiles = fs.readdirSync(configDir).filter((file) => (
      file.endsWith('.ts') || file.endsWith('.js')
    ));

    for (const file of configFiles) {
      const screenerKey = file.replace(/\.(ts|js)$/, '').toLowerCase();

      try {
        const configModule = require(path.join(configDir, file));
        const config = configModule.default || configModule[`${screenerKey}ScreenerConfig`];

        if (config?.ops) {
          configCache.set(screenerKey, config);
          console.log(`  ✅ Loaded screener config: ${screenerKey}`);
        }
      } catch (error) {
        console.error(`  ❌ Failed to load screener config: ${file}`, error);
      }
    }
  }

  isLoaded = true;
  console.log('✅ Screener configs loaded');
}

export function initializeScreenerServices(): void {
  loadConfigs();
}

export function getScreenerService(key: string): IScreenerService | undefined {
  loadConfigs();
  const normalizedKey = key.toLowerCase();
  const cached = serviceCache.get(normalizedKey);
  if (cached) {
    return cached;
  }

  const config = configCache.get(normalizedKey);
  if (!config) {
    return undefined;
  }

  const service = new ScreenerService(normalizedKey, config);
  serviceCache.set(normalizedKey, service);
  return service;
}

export function getAllRegisteredScreeners(): string[] {
  loadConfigs();
  return Array.from(configCache.keys());
}

export { ScreenerInput, ScreenerResult, IScreenerService } from './types';
