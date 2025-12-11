/**
 * Fast Backtest Engine
 * Core synchronous loop for high-performance backtesting
 */

import {
  Bar,
  StrategyIR,
  FastBacktestConfig,
  FastBacktestResult,
  Rule,
  Condition,
  ConditionGroup,
  ValueRef,
  ActionType,
  Trade
} from './strategyIR';
import {
  IndicatorContext,
  createIndicatorContext,
  initializeIndicators,
  updateAllIndicators,
  allIndicatorsReady,
  getIndicatorValueById,
  getPrevIndicatorValue
} from './indicatorEngine';
import { SimBrokerFast } from './simBrokerFast';
import { calculateMetrics } from './metricsCalculator';

// ============= Signal Type =============

interface Signal {
  action: ActionType;
  quantity: number;
  orderType: 'market' | 'limit' | 'stop';
  limitPrice?: number;
  stopPrice?: number;
}

// ============= Main Engine Function =============

export async function runBacktestFast(
  config: FastBacktestConfig,
  ir: StrategyIR,
  barsBySymbol: Record<string, Bar[]>
): Promise<FastBacktestResult> {
  const startTime = performance.now();
  
  // Initialize broker
  const broker = new SimBrokerFast(config);
  
  // Initialize indicator context
  const indicatorCtx = createIndicatorContext();
  initializeIndicators(indicatorCtx, ir.indicators);
  
  // For now, single symbol support
  const symbol = ir.universe.symbols[0];
  const bars = barsBySymbol[symbol] || [];
  
  if (bars.length === 0) {
    return createEmptyResult(config, ir, startTime);
  }
  
  // Sort bars by timestamp
  const sortedBars = [...bars].sort((a, b) => a.t - b.t);
  
  // Filter bars by date range
  const startTs = new Date(config.startDate).getTime();
  const endTs = new Date(config.endDate).getTime();
  const filteredBars = sortedBars.filter(b => b.t >= startTs && b.t <= endTs);
  
  let barsProcessed = 0;
  
  // ============= MAIN BACKTEST LOOP =============
  for (let i = 0; i < filteredBars.length; i++) {
    const bar = filteredBars[i];
    
    // Process any pending orders from previous bar
    broker.processPendingOrders(symbol, bar);
    
    // Update all indicators
    updateAllIndicators(indicatorCtx, bar);
    barsProcessed++;
    
    // Skip until indicators are warmed up
    if (!allIndicatorsReady(indicatorCtx)) {
      continue;
    }
    
    // Get current prices map for portfolio valuation
    const currentPrices = new Map<string, number>([[symbol, bar.c]]);
    
    // Evaluate exit rules first (close positions before opening new ones)
    for (const rule of ir.exitRules) {
      const shouldExecute = evaluateRule(rule, indicatorCtx, bar, broker, symbol);
      if (shouldExecute) {
        const signal = createSignalFromRule(rule, broker, symbol, bar, config);
        executeSignal(broker, signal, symbol, bar);
        break; // One exit per bar
      }
    }
    
    // Evaluate entry rules
    for (const rule of ir.entryRules) {
      const shouldExecute = evaluateRule(rule, indicatorCtx, bar, broker, symbol);
      if (shouldExecute) {
        const signal = createSignalFromRule(rule, broker, symbol, bar, config);
        executeSignal(broker, signal, symbol, bar);
        break; // One entry per bar
      }
    }
    
    // Record equity snapshot (sample rate)
    if (i % config.equitySampleRate === 0 || i === filteredBars.length - 1) {
      broker.recordEquity(bar.t, currentPrices);
    }
    
    // Check max drawdown stop
    if (ir.riskConfig.maxDrawdown) {
      const equityCurve = broker.getEquityCurve();
      if (equityCurve.length > 0) {
        const lastPoint = equityCurve[equityCurve.length - 1];
        if (lastPoint.drawdown > ir.riskConfig.maxDrawdown) {
          // Stop backtest - max drawdown exceeded
          break;
        }
      }
    }
  }
  
  // Close all remaining positions at final bar price
  if (filteredBars.length > 0) {
    const lastBar = filteredBars[filteredBars.length - 1];
    const finalPrices = new Map<string, number>([[symbol, lastBar.c]]);
    broker.closeAllPositions(finalPrices, lastBar.t);
    broker.recordEquity(lastBar.t, finalPrices);
  }
  
  const executionTimeMs = performance.now() - startTime;
  
  // Calculate metrics
  const trades = broker.getTrades();
  const equityCurve = broker.getEquityCurve();
  const metrics = calculateMetrics(trades, equityCurve, config.initialCash);
  
  return {
    backtestId: config.backtestId,
    strategyId: ir.id,
    metrics,
    trades,
    equityCurve,
    barsProcessed,
    executionTimeMs,
    usedFastEngine: true
  };
}

// ============= Rule Evaluation =============

function evaluateRule(
  rule: Rule,
  ctx: IndicatorContext,
  bar: Bar,
  broker: SimBrokerFast,
  symbol: string
): boolean {
  return evaluateConditions(rule.conditions, ctx, bar, broker, symbol);
}

function evaluateConditions(
  conditions: Condition | ConditionGroup,
  ctx: IndicatorContext,
  bar: Bar,
  broker: SimBrokerFast,
  symbol: string
): boolean {
  if ('logic' in conditions) {
    // ConditionGroup
    if (conditions.logic === 'AND') {
      return conditions.conditions.every(c => 
        evaluateConditions(c as Condition | ConditionGroup, ctx, bar, broker, symbol)
      );
    } else {
      return conditions.conditions.some(c => 
        evaluateConditions(c as Condition | ConditionGroup, ctx, bar, broker, symbol)
      );
    }
  }
  
  // Single condition
  return evaluateCondition(conditions, ctx, bar, broker, symbol);
}

function evaluateCondition(
  condition: Condition,
  ctx: IndicatorContext,
  bar: Bar,
  broker: SimBrokerFast,
  symbol: string
): boolean {
  const leftValue = resolveValue(condition.left, ctx, bar, broker, symbol);
  const rightValue = resolveValue(condition.right, ctx, bar, broker, symbol);
  
  if (leftValue === null || rightValue === null) {
    return false;
  }
  
  switch (condition.op) {
    case '>':
      return leftValue > rightValue;
    case '<':
      return leftValue < rightValue;
    case '>=':
      return leftValue >= rightValue;
    case '<=':
      return leftValue <= rightValue;
    case '==':
      return Math.abs(leftValue - rightValue) < 0.0001;
    case '!=':
      return Math.abs(leftValue - rightValue) >= 0.0001;
    case 'crosses_above':
      return evaluateCrossover(condition.left, condition.right, ctx, bar, broker, symbol, 'above');
    case 'crosses_below':
      return evaluateCrossover(condition.left, condition.right, ctx, bar, broker, symbol, 'below');
    default:
      return false;
  }
}

function evaluateCrossover(
  leftRef: ValueRef,
  rightRef: ValueRef,
  ctx: IndicatorContext,
  bar: Bar,
  broker: SimBrokerFast,
  symbol: string,
  direction: 'above' | 'below'
): boolean {
  const currentLeft = resolveValue(leftRef, ctx, bar, broker, symbol);
  const currentRight = resolveValue(rightRef, ctx, bar, broker, symbol);
  
  if (currentLeft === null || currentRight === null) {
    return false;
  }
  
  // Get previous values for crossover detection
  let prevLeft: number | null = null;
  let prevRight: number | null = null;
  
  if (leftRef.type === 'indicator') {
    prevLeft = getPrevIndicatorValue(ctx, leftRef.ref);
  }
  if (rightRef.type === 'indicator') {
    prevRight = getPrevIndicatorValue(ctx, rightRef.ref);
  }
  
  // If we can't get previous values, fall back to simple comparison
  if (prevLeft === null) prevLeft = currentLeft;
  if (prevRight === null) prevRight = currentRight;
  
  if (direction === 'above') {
    // Left crossed above right
    return prevLeft <= prevRight && currentLeft > currentRight;
  } else {
    // Left crossed below right
    return prevLeft >= prevRight && currentLeft < currentRight;
  }
}

function resolveValue(
  ref: ValueRef,
  ctx: IndicatorContext,
  bar: Bar,
  broker: SimBrokerFast,
  symbol: string
): number | null {
  switch (ref.type) {
    case 'indicator':
      return getIndicatorValueById(ctx, ref.ref, ref.field);
    
    case 'price':
      switch (ref.ref) {
        case 'open': return bar.o;
        case 'high': return bar.h;
        case 'low': return bar.l;
        case 'close': return bar.c;
        case 'volume': return bar.v;
        case 'hl2': return (bar.h + bar.l) / 2;
        case 'hlc3': return (bar.h + bar.l + bar.c) / 3;
        case 'ohlc4': return (bar.o + bar.h + bar.l + bar.c) / 4;
        default: return bar.c;
      }
    
    case 'number':
      return parseFloat(ref.ref);
    
    case 'position':
      const position = broker.getPosition(symbol);
      if (!position) return 0;
      
      if (ref.ref === 'quantity' || ref.ref === 'position.quantity') {
        return position.quantity;
      }
      if (ref.ref === 'avgPrice' || ref.ref === 'position.avgPrice') {
        return position.avgPrice;
      }
      if (ref.ref === 'hasPosition') {
        return broker.hasPosition(symbol) ? 1 : 0;
      }
      if (ref.ref === 'isLong') {
        return broker.isLong(symbol) ? 1 : 0;
      }
      if (ref.ref === 'isShort') {
        return broker.isShort(symbol) ? 1 : 0;
      }
      return 0;
    
    default:
      return null;
  }
}

// ============= Signal Creation & Execution =============

function createSignalFromRule(
  rule: Rule,
  broker: SimBrokerFast,
  symbol: string,
  bar: Bar,
  config: FastBacktestConfig
): Signal {
  let quantity = calculateQuantity(rule.quantity, broker, symbol, bar, config);
  
  return {
    action: rule.action,
    quantity,
    orderType: rule.orderType || 'market',
    limitPrice: rule.limitPrice ? resolveValueRef(rule.limitPrice, bar) : undefined,
    stopPrice: rule.stopPrice ? resolveValueRef(rule.stopPrice, bar) : undefined
  };
}

function calculateQuantity(
  qtyExpr: { type: string; value: number },
  broker: SimBrokerFast,
  symbol: string,
  bar: Bar,
  config: FastBacktestConfig
): number {
  switch (qtyExpr.type) {
    case 'fixed':
      return qtyExpr.value;
    
    case 'percent_equity': {
      const equity = broker.getEquity(new Map([[symbol, bar.c]]));
      const amount = equity * (qtyExpr.value / 100);
      return Math.floor(amount / bar.c);
    }
    
    case 'percent_cash': {
      const cash = broker.getCash();
      const amount = cash * (qtyExpr.value / 100);
      return Math.floor(amount / bar.c);
    }
    
    case 'all_in': {
      const cash = broker.getCash();
      return Math.floor(cash / bar.c);
    }
    
    case 'risk_per_trade': {
      // Risk a percentage of equity per trade
      // Assumes a stop loss is set
      const equity = broker.getEquity(new Map([[symbol, bar.c]]));
      const riskAmount = equity * (qtyExpr.value / 100);
      // Without a stop loss, default to 2% of equity
      const stopDistance = bar.c * 0.02;
      return Math.floor(riskAmount / stopDistance);
    }
    
    default:
      return 1;
  }
}

function resolveValueRef(ref: ValueRef, bar: Bar): number | undefined {
  if (ref.type === 'number') {
    return parseFloat(ref.ref);
  }
  if (ref.type === 'price') {
    switch (ref.ref) {
      case 'open': return bar.o;
      case 'high': return bar.h;
      case 'low': return bar.l;
      case 'close': return bar.c;
      default: return bar.c;
    }
  }
  return undefined;
}

function executeSignal(
  broker: SimBrokerFast,
  signal: Signal,
  symbol: string,
  bar: Bar
): Trade | null {
  if (signal.action === 'NOOP') {
    return null;
  }
  
  switch (signal.action) {
    case 'BUY':
      if (signal.orderType === 'market') {
        return broker.marketOrder(symbol, 'buy', signal.quantity, bar);
      } else if (signal.orderType === 'limit' && signal.limitPrice) {
        broker.limitOrder(symbol, 'buy', signal.quantity, signal.limitPrice, bar);
        return null;
      } else if (signal.orderType === 'stop' && signal.stopPrice) {
        broker.stopOrder(symbol, 'buy', signal.quantity, signal.stopPrice, bar);
        return null;
      }
      break;
    
    case 'SELL':
      if (signal.orderType === 'market') {
        return broker.marketOrder(symbol, 'sell', signal.quantity, bar);
      } else if (signal.orderType === 'limit' && signal.limitPrice) {
        broker.limitOrder(symbol, 'sell', signal.quantity, signal.limitPrice, bar);
        return null;
      } else if (signal.orderType === 'stop' && signal.stopPrice) {
        broker.stopOrder(symbol, 'sell', signal.quantity, signal.stopPrice, bar);
        return null;
      }
      break;
    
    case 'CLOSE_LONG':
      if (broker.isLong(symbol)) {
        return broker.closePosition(symbol, bar);
      }
      break;
    
    case 'CLOSE_SHORT':
      if (broker.isShort(symbol)) {
        return broker.closePosition(symbol, bar);
      }
      break;
    
    case 'CLOSE_ALL':
      return broker.closePosition(symbol, bar);
  }
  
  return null;
}

// ============= Helper Functions =============

function createEmptyResult(
  config: FastBacktestConfig,
  ir: StrategyIR,
  startTime: number
): FastBacktestResult {
  return {
    backtestId: config.backtestId,
    strategyId: ir.id,
    metrics: {
      totalReturn: 0,
      totalReturnPercent: 0,
      annualizedReturn: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      calmarRatio: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      profitFactor: 0,
      expectancy: 0,
      avgHoldingPeriod: 0,
      totalCommission: 0,
      totalSlippage: 0,
      finalEquity: config.initialCash,
      finalCash: config.initialCash
    },
    trades: [],
    equityCurve: [],
    barsProcessed: 0,
    executionTimeMs: performance.now() - startTime,
    usedFastEngine: true
  };
}

// ============= Multi-Symbol Support (Future) =============

export async function runBacktestFastMultiSymbol(
  config: FastBacktestConfig,
  ir: StrategyIR,
  barsBySymbol: Record<string, Bar[]>
): Promise<FastBacktestResult> {
  // For multi-symbol, we need to align bars by timestamp
  // and process all symbols at each time step
  // This is a more complex implementation for future
  
  // For now, run single symbol
  return runBacktestFast(config, ir, barsBySymbol);
}
