/**
 * Fast Backtest Engine - Module Exports
 */

// Core types
export * from './strategyIR';

// Strategy compilation
export { 
  StrategyCompiler,
  isWorkflowCompilable, 
  compileWorkflow 
} from './strategyCompiler';

// Indicator engine
export {
  createIndicatorContext,
  initializeIndicators,
  updateAllIndicators,
  allIndicatorsReady,
  getIndicatorValueById,
  getPrevIndicatorValue,
  // Individual indicator creators
  createRSI,
  createEMA,
  createSMA,
  createMACD,
  createBB,
  createStoch,
  createVWAP,
  createADX,
  createOBV,
  createATR,
  // Individual indicator updaters
  updateRSI,
  updateEMA,
  updateSMA,
  updateMACD,
  updateBB,
  updateStoch,
  updateVWAP,
  updateADX,
  updateOBV,
  updateATR,
  // Types
  type IndicatorContext,
  type IndicatorState,
  type RSIState,
  type EMAState,
  type SMAState,
  type MACDState,
  type BBState,
  type StochState,
  type VWAPState,
  type ADXState,
  type OBVState,
  type ATRState
} from './indicatorEngine';

// Fast broker
export { SimBrokerFast, type Position, type PendingOrder } from './simBrokerFast';

// Fast backtest engine
export { runBacktestFast, runBacktestFastMultiSymbol } from './fastBacktestEngine';

// Metrics calculation
export { 
  calculateMetrics, 
  calculateRollingMetrics,
  analyzeTradesByTime 
} from './metricsCalculator';
