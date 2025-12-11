/**
 * Metrics Calculator
 * Calculate comprehensive backtest performance metrics
 */

import { Trade, EquityPoint, BacktestMetrics } from './strategyIR';

export function calculateMetrics(
  trades: Trade[],
  equityCurve: EquityPoint[],
  initialCash: number
): BacktestMetrics {
  // Get final equity
  const finalEquity = equityCurve.length > 0 
    ? equityCurve[equityCurve.length - 1].equity 
    : initialCash;
  
  const finalCash = equityCurve.length > 0
    ? equityCurve[equityCurve.length - 1].cash
    : initialCash;
  
  // Total return
  const totalReturn = finalEquity - initialCash;
  const totalReturnPercent = initialCash > 0 ? (totalReturn / initialCash) * 100 : 0;
  
  // Annualized return (assuming daily data)
  const tradingDays = equityCurve.length;
  const yearsTraded = tradingDays / 252;
  const annualizedReturn = yearsTraded > 0 
    ? (Math.pow(finalEquity / initialCash, 1 / yearsTraded) - 1) * 100 
    : 0;
  
  // Trade statistics
  const closedTrades = trades.filter(t => t.exitPrice !== undefined);
  const winningTrades = closedTrades.filter(t => (t.pnl || 0) > 0);
  const losingTrades = closedTrades.filter(t => (t.pnl || 0) < 0);
  
  const totalTrades = closedTrades.length;
  const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
  
  // P&L metrics
  const wins = winningTrades.map(t => t.pnl || 0);
  const losses = losingTrades.map(t => Math.abs(t.pnl || 0));
  
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  const largestWin = wins.length > 0 ? Math.max(...wins) : 0;
  const largestLoss = losses.length > 0 ? Math.max(...losses) : 0;
  
  const totalWins = wins.reduce((a, b) => a + b, 0);
  const totalLosses = losses.reduce((a, b) => a + b, 0);
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
  
  // Expectancy (average trade P&L)
  const allPnL = closedTrades.map(t => t.pnl || 0);
  const expectancy = allPnL.length > 0 ? allPnL.reduce((a, b) => a + b, 0) / allPnL.length : 0;
  
  // Holding period
  const holdingPeriods = closedTrades.map(t => t.holdingPeriod || 0).filter(h => h > 0);
  const avgHoldingPeriod = holdingPeriods.length > 0 
    ? holdingPeriods.reduce((a, b) => a + b, 0) / holdingPeriods.length 
    : 0;
  
  // Commission and slippage
  const totalCommission = trades.reduce((sum, t) => sum + t.commission, 0);
  const totalSlippage = trades.reduce((sum, t) => sum + t.slippage, 0);
  
  // Risk metrics from equity curve
  const { sharpeRatio, sortinoRatio, maxDrawdown, maxDrawdownPercent } = 
    calculateRiskMetrics(equityCurve);
  
  // Calmar ratio (annualized return / max drawdown)
  const calmarRatio = maxDrawdownPercent > 0 
    ? annualizedReturn / maxDrawdownPercent 
    : 0;
  
  return {
    totalReturn,
    totalReturnPercent,
    annualizedReturn,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown,
    maxDrawdownPercent,
    calmarRatio,
    totalTrades,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate,
    avgWin,
    avgLoss,
    largestWin,
    largestLoss,
    profitFactor,
    expectancy,
    avgHoldingPeriod,
    totalCommission,
    totalSlippage,
    finalEquity,
    finalCash
  };
}

function calculateRiskMetrics(equityCurve: EquityPoint[]): {
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
} {
  if (equityCurve.length < 2) {
    return {
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0
    };
  }
  
  // Calculate daily returns
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prevEquity = equityCurve[i - 1].equity;
    const currEquity = equityCurve[i].equity;
    if (prevEquity > 0) {
      returns.push((currEquity - prevEquity) / prevEquity);
    }
  }
  
  if (returns.length === 0) {
    return {
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0
    };
  }
  
  // Mean return
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  
  // Standard deviation
  const squaredDiffs = returns.map(r => Math.pow(r - meanReturn, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  // Downside deviation (for Sortino)
  const negativeReturns = returns.filter(r => r < 0);
  const downsideVariance = negativeReturns.length > 0
    ? negativeReturns.map(r => Math.pow(r, 2)).reduce((a, b) => a + b, 0) / negativeReturns.length
    : 0;
  const downsideDeviation = Math.sqrt(downsideVariance);
  
  // Sharpe ratio (annualized, assuming 252 trading days, risk-free rate = 0)
  const annualizedMeanReturn = meanReturn * 252;
  const annualizedStdDev = stdDev * Math.sqrt(252);
  const sharpeRatio = annualizedStdDev > 0 ? annualizedMeanReturn / annualizedStdDev : 0;
  
  // Sortino ratio
  const annualizedDownsideDev = downsideDeviation * Math.sqrt(252);
  const sortinoRatio = annualizedDownsideDev > 0 ? annualizedMeanReturn / annualizedDownsideDev : 0;
  
  // Max drawdown
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let peak = equityCurve[0].equity;
  
  for (const point of equityCurve) {
    if (point.equity > peak) {
      peak = point.equity;
    }
    
    const drawdown = peak - point.equity;
    const drawdownPercent = peak > 0 ? (drawdown / peak) * 100 : 0;
    
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPercent = drawdownPercent;
    }
  }
  
  return {
    sharpeRatio,
    sortinoRatio,
    maxDrawdown,
    maxDrawdownPercent
  };
}

/**
 * Calculate rolling metrics for visualization
 */
export function calculateRollingMetrics(
  equityCurve: EquityPoint[],
  windowSize: number = 20
): {
  rollingReturn: number[];
  rollingVolatility: number[];
  rollingSharpe: number[];
}[] {
  const result: any[] = [];
  
  for (let i = windowSize; i < equityCurve.length; i++) {
    const window = equityCurve.slice(i - windowSize, i);
    
    // Calculate returns in window
    const returns: number[] = [];
    for (let j = 1; j < window.length; j++) {
      const prevEquity = window[j - 1].equity;
      const currEquity = window[j].equity;
      if (prevEquity > 0) {
        returns.push((currEquity - prevEquity) / prevEquity);
      }
    }
    
    const meanReturn = returns.length > 0 
      ? returns.reduce((a, b) => a + b, 0) / returns.length 
      : 0;
    
    const variance = returns.length > 0
      ? returns.map(r => Math.pow(r - meanReturn, 2)).reduce((a, b) => a + b, 0) / returns.length
      : 0;
    const stdDev = Math.sqrt(variance);
    
    result.push({
      timestamp: equityCurve[i].timestamp,
      rollingReturn: meanReturn * 252 * 100, // Annualized %
      rollingVolatility: stdDev * Math.sqrt(252) * 100, // Annualized %
      rollingSharpe: stdDev > 0 ? (meanReturn * 252) / (stdDev * Math.sqrt(252)) : 0
    });
  }
  
  return result;
}

/**
 * Generate trade analysis breakdown
 */
export function analyzeTradesByTime(trades: Trade[]): {
  byHour: Record<number, { count: number; pnl: number }>;
  byDayOfWeek: Record<number, { count: number; pnl: number }>;
  byMonth: Record<number, { count: number; pnl: number }>;
} {
  const byHour: Record<number, { count: number; pnl: number }> = {};
  const byDayOfWeek: Record<number, { count: number; pnl: number }> = {};
  const byMonth: Record<number, { count: number; pnl: number }> = {};
  
  for (const trade of trades) {
    if (trade.exitTime === undefined) continue;
    
    const exitDate = new Date(trade.exitTime);
    const hour = exitDate.getHours();
    const dayOfWeek = exitDate.getDay();
    const month = exitDate.getMonth();
    const pnl = trade.pnl || 0;
    
    // By hour
    if (!byHour[hour]) byHour[hour] = { count: 0, pnl: 0 };
    byHour[hour].count++;
    byHour[hour].pnl += pnl;
    
    // By day of week
    if (!byDayOfWeek[dayOfWeek]) byDayOfWeek[dayOfWeek] = { count: 0, pnl: 0 };
    byDayOfWeek[dayOfWeek].count++;
    byDayOfWeek[dayOfWeek].pnl += pnl;
    
    // By month
    if (!byMonth[month]) byMonth[month] = { count: 0, pnl: 0 };
    byMonth[month].count++;
    byMonth[month].pnl += pnl;
  }
  
  return { byHour, byDayOfWeek, byMonth };
}
