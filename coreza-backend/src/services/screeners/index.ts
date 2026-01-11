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
import { registerScreener } from './registry';
import { ScreenerService } from './ScreenerService';

// Registry of custom screener services that don't use ScreenerService configs
const CUSTOM_SCREENERS: Record<string, () => any> = {
};

export function initializeScreenerServices() {
  console.log('📊 Initializing screener services...');

  // 1. Auto-discover and register config-based screeners from configs/ directory
  const configDir = path.join(__dirname, 'configs');
  
  if (fs.existsSync(configDir)) {
    const configFiles = fs.readdirSync(configDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
    
    for (const file of configFiles) {
      const screenerKey = file.replace(/\.(ts|js)$/, '');
      
      try {
        // Use require for synchronous loading
        const configModule = require(path.join(configDir, file));
        const config = configModule.default || configModule[`${screenerKey}ScreenerConfig`];
        
        if (config?.ops) {
          registerScreener(new ScreenerService(screenerKey, config));
          console.log(`  ✅ Registered screener: ${screenerKey}`);
        }
      } catch (error) {
        console.error(`  ❌ Failed to load screener config: ${file}`, error);
      }
    }
  }

  // 2. Register custom screeners (non-REST based)
  for (const [key, factory] of Object.entries(CUSTOM_SCREENERS)) {
    try {
      registerScreener(factory());
      console.log(`  ✅ Registered custom screener: ${key}`);
    } catch (error) {
      console.error(`  ❌ Failed to register custom screener: ${key}`, error);
    }
  }

  console.log('✅ All screener services initialized');
}

// Re-export for convenience
export { getScreenerService, getAllRegisteredScreeners } from './registry';
export { ScreenerInput, ScreenerResult, IScreenerService } from './types';
