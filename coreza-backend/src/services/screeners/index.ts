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

import { registerScreener } from './registry';
import { RestScreenerService } from './RestScreenerService';
import { alpacaScreenerConfig } from './configs/alpaca';
import { binanceScreenerConfig } from './configs/binance';
import { YahooFinanceScreenerService } from './YahooFinanceScreenerService';
import { SchwabScreenerService } from './SchwabScreenerService';

export function initializeScreenerServices() {
  console.log('📊 Initializing screener services...');

  // Register Alpaca screener
  registerScreener(new RestScreenerService('alpaca', alpacaScreenerConfig));

  // Register Binance screener
  registerScreener(new RestScreenerService('binance', binanceScreenerConfig));

  // Register YahooFinance screener
  registerScreener(new YahooFinanceScreenerService());

  // Register Schwab screener
  registerScreener(new SchwabScreenerService());

  // Future: Register Binance, Manual, etc.
  // registerScreener(new RestScreenerService('binance', binanceScreenerConfig));
  // registerScreener(new ManualScreenerService());

  console.log('✅ All screener services initialized');
}

// Re-export for convenience
export { getScreenerService, getAllRegisteredScreeners } from './registry';
export { ScreenerInput, ScreenerResult, IScreenerService } from './types';
