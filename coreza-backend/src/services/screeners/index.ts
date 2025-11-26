import { registerScreener } from './registry';
import { RestScreenerService } from './RestScreenerService';
import { alpacaScreenerConfig } from './configs/alpaca';
import { YahooFinanceScreenerService } from './YahooFinanceScreenerService';
import { SchwabScreenerService } from './SchwabScreenerService';

export function initializeScreenerServices() {
  console.log('📊 Initializing screener services...');

  // Register Alpaca screener
  registerScreener(new RestScreenerService('alpaca', alpacaScreenerConfig));

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
