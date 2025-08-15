import { PerformanceMetrics, Portfolio } from './types';

export class PerformanceAnalyzer {
  
  // Calculate comprehensive performance metrics
  static calculateMetrics(
    portfolio: Portfolio, 
    initialCapital: number,
    riskFreeRate: number = 0.02, // 2% annual risk-free rate
    benchmarkReturns?: number[]
  ): PerformanceMetrics {
    
    const returns = portfolio.daily_returns;
    const equityCurve = portfolio.equity_curve;
    const finalValue = portfolio.total_value;
    
    // Basic return calculations
    const totalReturn = (finalValue - initialCapital) / initialCapital;
    const tradingDays = returns.length;
    const annualizedReturn = tradingDays > 0 ? 
      Math.pow(1 + totalReturn, 252 / tradingDays) - 1 : 0;
    
    // Risk calculations
    const meanReturn = returns.length > 0 ? 
      returns.reduce((sum, r) => sum + r, 0) / returns.length : 0;
    const variance = returns.length > 0 ? 
      returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length : 0;
    const volatility = Math.sqrt(variance * 252); // Annualized
    
    // Sharpe Ratio
    const excessReturn = annualizedReturn - riskFreeRate;
    const sharpeRatio = volatility > 0 ? excessReturn / volatility : 0;
    
    // Sortino Ratio (using downside deviation)
    const downsideReturns = returns.filter(r => r < 0);
    const downsideVariance = downsideReturns.length > 0 ?
      downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length : 0;
    const downsideDeviation = Math.sqrt(downsideVariance * 252);
    const sortinoRatio = downsideDeviation > 0 ? excessReturn / downsideDeviation : 0;
    
    // Drawdown analysis
    const drawdowns = portfolio.drawdowns.map(d => d.drawdown);
    const maxDrawdown = Math.max(...drawdowns, 0);
    const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;
    
    // Drawdown duration analysis
    let maxDrawdownDuration = 0;
    let currentDrawdownDuration = 0;
    let isInDrawdown = false;
    
    drawdowns.forEach(dd => {
      if (dd > 0.001) { // In drawdown (0.1% threshold)
        if (!isInDrawdown) {
          isInDrawdown = true;
          currentDrawdownDuration = 1;
        } else {
          currentDrawdownDuration++;
        }
      } else {
        if (isInDrawdown) {
          maxDrawdownDuration = Math.max(maxDrawdownDuration, currentDrawdownDuration);
          isInDrawdown = false;
          currentDrawdownDuration = 0;
        }
      }
    });
    
    const avgDrawdown = drawdowns.length > 0 ? 
      drawdowns.reduce((sum, dd) => sum + dd, 0) / drawdowns.length : 0;
    
    // Monthly returns calculation
    const monthlyReturns = this.calculateMonthlyReturns(equityCurve);
    
    // Value at Risk calculations
    const sortedReturns = [...returns].sort((a, b) => a - b);
    const var95Index = Math.floor(returns.length * 0.05);
    const var95 = returns.length > 0 ? sortedReturns[var95Index] || 0 : 0;
    
    // Conditional VaR (Expected Shortfall)
    const tailReturns = sortedReturns.slice(0, var95Index + 1);
    const cvar95 = tailReturns.length > 0 ? 
      tailReturns.reduce((sum, r) => sum + r, 0) / tailReturns.length : 0;
    
    // Trade analysis (simplified - would need actual trade data)
    const totalTrades = this.estimateTradeCount(portfolio);
    const winningTrades = Math.floor(totalTrades * 0.6); // Placeholder
    const losingTrades = totalTrades - winningTrades;
    const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
    
    // Calculate profit factor, avg win/loss (simplified)
    const avgWin = 0.02; // Placeholder
    const avgLoss = -0.015; // Placeholder
    const profitFactor = (winningTrades * avgWin) / Math.abs(losingTrades * avgLoss);
    
    const avgTradePnl = (finalValue - initialCapital) / Math.max(totalTrades, 1);
    const largestWin = Math.max(...returns, 0) * initialCapital;
    const largestLoss = Math.min(...returns, 0) * initialCapital;
    
    // Maximum leverage calculation
    const maxLeverage = this.calculateMaxLeverage(portfolio);
    
    // Benchmark comparison (if provided)
    let beta: number | undefined;
    let alpha: number | undefined;
    let informationRatio: number | undefined;
    let trackingError: number | undefined;
    
    if (benchmarkReturns && benchmarkReturns.length === returns.length) {
      const benchmarkStats = this.calculateBenchmarkStats(returns, benchmarkReturns);
      beta = benchmarkStats.beta;
      alpha = benchmarkStats.alpha;
      informationRatio = benchmarkStats.informationRatio;
      trackingError = benchmarkStats.trackingError;
    }
    
    return {
      // Returns
      total_return: totalReturn,
      annualized_return: annualizedReturn,
      monthly_returns: monthlyReturns,
      
      // Risk Metrics
      volatility: volatility,
      sharpe_ratio: sharpeRatio,
      sortino_ratio: sortinoRatio,
      calmar_ratio: calmarRatio,
      
      // Drawdown Analysis
      max_drawdown: maxDrawdown,
      max_drawdown_duration: maxDrawdownDuration,
      avg_drawdown: avgDrawdown,
      
      // Trade Analysis
      total_trades: totalTrades,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
      win_rate: winRate,
      profit_factor: profitFactor,
      avg_trade_pnl: avgTradePnl,
      avg_win: avgWin,
      avg_loss: avgLoss,
      largest_win: largestWin,
      largest_loss: largestLoss,
      
      // Risk Management
      var_95: var95,
      cvar_95: cvar95,
      max_leverage: maxLeverage,
      
      // Benchmark Comparison
      beta,
      alpha,
      information_ratio: informationRatio,
      tracking_error: trackingError
    };
  }
  
  private static calculateMonthlyReturns(equityCurve: Array<{ date: Date; value: number }>): number[] {
    const monthlyReturns: number[] = [];
    let lastMonthValue = equityCurve[0]?.value || 0;
    let lastMonth = equityCurve[0]?.date.getMonth() || 0;
    
    equityCurve.forEach(point => {
      const currentMonth = point.date.getMonth();
      if (currentMonth !== lastMonth) {
        const monthlyReturn = (point.value - lastMonthValue) / lastMonthValue;
        monthlyReturns.push(monthlyReturn);
        lastMonthValue = point.value;
        lastMonth = currentMonth;
      }
    });
    
    return monthlyReturns;
  }
  
  private static estimateTradeCount(portfolio: Portfolio): number {
    // Simple estimation based on portfolio changes
    // In real implementation, this would be tracked properly
    return Math.max(portfolio.equity_curve.length / 10, 1);
  }
  
  private static calculateMaxLeverage(portfolio: Portfolio): number {
    let maxLeverage = 1.0;
    
    portfolio.positions.forEach(position => {
      const positionValue = Math.abs(position.market_value);
      const portfolioValue = portfolio.total_value;
      const leverage = positionValue / portfolioValue;
      maxLeverage = Math.max(maxLeverage, leverage);
    });
    
    return maxLeverage;
  }
  
  private static calculateBenchmarkStats(
    portfolioReturns: number[], 
    benchmarkReturns: number[]
  ): {
    beta: number;
    alpha: number;
    informationRatio: number;
    trackingError: number;
  } {
    const n = portfolioReturns.length;
    
    // Calculate means
    const portfolioMean = portfolioReturns.reduce((sum, r) => sum + r, 0) / n;
    const benchmarkMean = benchmarkReturns.reduce((sum, r) => sum + r, 0) / n;
    
    // Calculate covariance and variance
    let covariance = 0;
    let benchmarkVariance = 0;
    
    for (let i = 0; i < n; i++) {
      const portfolioDeviation = portfolioReturns[i] - portfolioMean;
      const benchmarkDeviation = benchmarkReturns[i] - benchmarkMean;
      
      covariance += portfolioDeviation * benchmarkDeviation;
      benchmarkVariance += benchmarkDeviation * benchmarkDeviation;
    }
    
    covariance /= n;
    benchmarkVariance /= n;
    
    // Calculate beta
    const beta = benchmarkVariance > 0 ? covariance / benchmarkVariance : 0;
    
    // Calculate alpha (annualized)
    const alpha = (portfolioMean - beta * benchmarkMean) * 252;
    
    // Calculate tracking error and information ratio
    const excessReturns = portfolioReturns.map((r, i) => r - benchmarkReturns[i]);
    const excessMean = excessReturns.reduce((sum, r) => sum + r, 0) / n;
    const trackingErrorVariance = excessReturns.reduce((sum, r) => 
      sum + Math.pow(r - excessMean, 2), 0) / n;
    const trackingError = Math.sqrt(trackingErrorVariance * 252);
    
    const informationRatio = trackingError > 0 ? (excessMean * 252) / trackingError : 0;
    
    return { beta, alpha, informationRatio, trackingError };
  }
}