import { registerNodeExecutor } from './registry';
import { IOExecutor } from './executors/IOExecutor';
import { IndicatorsExecutor } from './executors/IndicatorsExecutor';
import { BrokerExecutor } from './executors/BrokerExecutor';
import { MarketExecutor } from './executors/MarketExecutor';
import { ControlFlowExecutor } from './executors/ControlFlowExecutor';
import { UtilityExecutor } from './executors/UtilityExecutor';
import { CommunicationExecutor } from './executors/CommunicationExecutor';
import { DataSourceExecutor } from './executors/DataSourceExecutor';
import { RiskExecutor } from './executors/RiskExecutor';

// Register all node executors
export function initializeNodeExecutors() {
  const executors = [
    new IOExecutor(),
    new IndicatorsExecutor(),
    new BrokerExecutor(),
    new MarketExecutor(),
    new ControlFlowExecutor(),
    new UtilityExecutor(),
    new CommunicationExecutor(),
    new DataSourceExecutor(),
    new RiskExecutor(),
  ];

  executors.forEach(executor => {
    try {
      registerNodeExecutor(executor);
    } catch (error) {
      console.error(`Failed to register executor ${executor.category}:`, error);
    }
  });

  console.log('🚀 Node executors initialized successfully');
}

// Export types and registry functions for external use
export * from './types';
export * from './registry';