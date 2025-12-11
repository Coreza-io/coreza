/**
 * Strategy Intermediate Representation (IR)
 * Compiled from visual workflow nodes for fast backtest execution
 */

// ============= Indicator Definitions =============

export type IndicatorType = 
  | 'RSI' | 'EMA' | 'SMA' | 'MACD' | 'BB' | 'STOCH' | 'VWAP' | 'ADX' | 'OBV' | 'ATR';

export type PriceField = 'open' | 'high' | 'low' | 'close' | 'volume' | 'hl2' | 'hlc3' | 'ohlc4';

export interface IndicatorDef {
  id: string;                          // Unique identifier, e.g., "rsi_14"
  type: IndicatorType;
  input: PriceField;
  params: Record<string, number>;      // e.g., { period: 14 } or { fastPeriod: 12, slowPeriod: 26 }
}

// ============= Condition & Rule Definitions =============

export type Comparator = 
  | '>' | '<' | '>=' | '<=' | '==' | '!=' 
  | 'crosses_above' | 'crosses_below';

export interface ValueRef {
  type: 'indicator' | 'price' | 'number' | 'position';
  ref: string;                         // Indicator ID, price field, or literal value
  field?: string;                      // Sub-field, e.g., 'upper' for BB, 'k' for Stoch
}

export interface Condition {
  left: ValueRef;
  op: Comparator;
  right: ValueRef;
}

export interface ConditionGroup {
  logic: 'AND' | 'OR';
  conditions: (Condition | ConditionGroup)[];
}

export type ActionType = 'BUY' | 'SELL' | 'CLOSE_LONG' | 'CLOSE_SHORT' | 'CLOSE_ALL' | 'NOOP';

export interface QuantityExpression {
  type: 'fixed' | 'percent_equity' | 'percent_cash' | 'risk_per_trade' | 'all_in';
  value: number;                       // e.g., 100 shares, 0.02 (2% equity)
}

export interface Rule {
  id: string;
  priority: number;                    // Higher = checked first
  conditions: Condition | ConditionGroup;
  action: ActionType;
  quantity: QuantityExpression;
  orderType?: 'market' | 'limit' | 'stop';
  limitPrice?: ValueRef;
  stopPrice?: ValueRef;
}

// ============= Risk Configuration =============

export interface RiskConfig {
  maxPositions?: number;               // Max concurrent positions
  maxRiskPerTrade?: number;            // % equity per trade
  maxDrawdown?: number;                // Stop backtest if exceeded
  trailingStop?: number;               // % trailing stop
  takeProfitPercent?: number;          // % take profit
  stopLossPercent?: number;            // % stop loss
}

// ============= Universe Configuration =============

export interface UniverseConfig {
  symbols: string[];
  timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';
}

// ============= Main Strategy IR =============

export interface StrategyIR {
  id: string;
  name: string;
  version: string;
  
  // Indicators to calculate
  indicators: IndicatorDef[];
  
  // Trading rules
  entryRules: Rule[];                  // Conditions to enter positions
  exitRules: Rule[];                   // Conditions to exit positions
  
  // Risk management
  riskConfig: RiskConfig;
  
  // Universe
  universe: UniverseConfig;
  
  // Metadata
  compiledAt: string;
  sourceWorkflowId?: string;
}

// ============= Backtest Configuration =============

export interface FastBacktestConfig {
  backtestId: string;
  initialCash: number;
  startDate: string;
  endDate: string;
  
  // Simulation settings
  commissionType: 'none' | 'per_share' | 'percentage' | 'fixed';
  commissionValue: number;
  slippageType: 'none' | 'fixed' | 'percentage';
  slippageValue: number;
  
  // Execution settings
  fillModel: 'immediate' | 'next_bar_open';
  allowShort: boolean;
  
  // Sampling
  equitySampleRate: number;            // Record equity every N bars
}

// ============= Bar Data =============

export interface Bar {
  t: number;      // Timestamp (ms)
  o: number;      // Open
  h: number;      // High
  l: number;      // Low
  c: number;      // Close
  v: number;      // Volume
}

// ============= Backtest Results =============

export interface Trade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice: number;
  entryTime: number;
  exitPrice?: number;
  exitTime?: number;
  pnl?: number;
  pnlPercent?: number;
  commission: number;
  slippage: number;
  holdingPeriod?: number;              // In bars
}

export interface EquityPoint {
  timestamp: number;
  equity: number;
  cash: number;
  positionValue: number;
  drawdown: number;
  dailyReturn?: number;
}

export interface BacktestMetrics {
  // Returns
  totalReturn: number;
  totalReturnPercent: number;
  annualizedReturn: number;
  
  // Risk metrics
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  calmarRatio: number;
  
  // Trade statistics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  
  // P&L
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  expectancy: number;
  
  // Execution
  avgHoldingPeriod: number;
  totalCommission: number;
  totalSlippage: number;
  
  // Final state
  finalEquity: number;
  finalCash: number;
}

export interface FastBacktestResult {
  backtestId: string;
  strategyId: string;
  
  // Performance
  metrics: BacktestMetrics;
  
  // Detailed data
  trades: Trade[];
  equityCurve: EquityPoint[];
  
  // Execution info
  barsProcessed: number;
  executionTimeMs: number;
  usedFastEngine: boolean;
}

// ============= Compilation Result =============

export interface CompilationResult {
  success: boolean;
  ir?: StrategyIR;
  errors?: string[];
  warnings?: string[];
  unsupportedNodes?: string[];
}
