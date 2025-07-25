import { registerBroker } from './registry';
import { AlpacaService } from './AlpacaService';
import { DhanService } from './DhanService';

export function initializeBrokerServices() {
  console.log('🚀 Initializing broker services...');
  
  [
    AlpacaService,
    DhanService,
    // Add future broker services here
  ].forEach(BrokerClass => {
    registerBroker(new BrokerClass());
  });
  
  console.log('✅ All broker services initialized');
}

// Re-export for convenience
export { getBrokerService, getAllRegisteredBrokers } from './registry';
export { BrokerInput, BrokerResult, IBrokerService } from './types';