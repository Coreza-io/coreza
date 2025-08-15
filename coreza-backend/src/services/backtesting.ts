import { supabase } from '../config/supabase';
import { DataService } from './data';
import { EngineV2 } from './engineV2';
import { WorkflowNode, WorkflowEdge, Item } from '../nodes/types';
import { createError } from '../middleware/errorHandler';

export interface BacktestConfig {
  id?: string;
  user_id: string;
  workflow_id: string;
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  commission_rate: number;
  slippage_rate: number;
  data_frequency: string;
}

export interface BacktestResult {
  total_return: number;
  annualized_return: number;
  max_drawdown: number;
  sharpe_ratio: number;
  win_rate: number;
  total_trades: number;
  profitable_trades: number;
  average_trade_return: number;
  largest_win: number;
  largest_loss: number;
  final_portfolio_value: number;
}

export interface BacktestTrade {
  symbol: string;
  action: 'buy' | 'sell';
  quantity: number;
  price: number;
  timestamp: Date;
  commission: number;
  slippage: number;
  portfolio_value_before: number;
  portfolio_value_after: number;
}

export interface PortfolioSnapshot {
  date: Date;
  cash_balance: number;
  stock_value: number;
  total_value: number;
  daily_return: number;
}

export class BacktestingService {
  private portfolio: Map<string, number> = new Map(); // symbol -> quantity
  private cash: number = 0;
  private trades: BacktestTrade[] = [];
  private portfolioSnapshots: PortfolioSnapshot[] = [];
  private historicalData: Map<string, any[]> = new Map();

  async createBacktest(config: BacktestConfig): Promise<string> {
    try {
      const { data, error } = await supabase
        .from('backtests')
        .insert({
          user_id: config.user_id,
          workflow_id: config.workflow_id,
          name: config.name,
          description: config.description,
          start_date: config.start_date,
          end_date: config.end_date,
          initial_capital: config.initial_capital,
          commission_rate: config.commission_rate,
          slippage_rate: config.slippage_rate,
          data_frequency: config.data_frequency,
          status: 'pending'
        })
        .select('id')
        .single();

      if (error) {
        throw createError('Failed to create backtest', 500);
      }

      return data.id;
    } catch (error) {
      throw createError(`Failed to create backtest: ${error instanceof Error ? error.message : 'Unknown error'}`, 500);
    }
  }

  async runBacktest(backtestId: string): Promise<void> {
    try {
      // Update status to running
      await supabase
        .from('backtests')
        .update({ 
          status: 'running',
          started_at: new Date().toISOString()
        })
        .eq('id', backtestId);

      // Get backtest configuration
      const { data: backtest, error: backtestError } = await supabase
        .from('backtests')
        .select('*, workflows(nodes, edges)')
        .eq('id', backtestId)
        .single();

      if (backtestError || !backtest) {
        throw createError('Backtest not found', 404);
      }

      // Initialize portfolio
      this.cash = backtest.initial_capital;
      this.portfolio.clear();
      this.trades = [];
      this.portfolioSnapshots = [];

      // Get workflow
      const workflow = backtest.workflows;
      const nodes: WorkflowNode[] = workflow.nodes;
      const edges: WorkflowEdge[] = workflow.edges;

      // Load historical data for all symbols used in the workflow
      await this.loadHistoricalData(nodes, backtest.start_date, backtest.end_date, backtest.data_frequency);

      // Run backtest simulation
      await this.simulateBacktest(nodes, edges, backtest);

      // Calculate performance metrics
      const results = this.calculatePerformanceMetrics(backtest.initial_capital);

      // Save results
      await this.saveBacktestResults(backtestId, results, this.trades, this.portfolioSnapshots);

      // Update status to completed
      await supabase
        .from('backtests')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', backtestId);

    } catch (error) {
      // Update status to failed
      await supabase
        .from('backtests')
        .update({ 
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error',
          completed_at: new Date().toISOString()
        })
        .eq('id', backtestId);
      
      throw error;
    }
  }

  private async loadHistoricalData(nodes: WorkflowNode[], startDate: string, endDate: string, frequency: string): Promise<void> {
    const symbols = new Set<string>();
    
    // Extract symbols from workflow nodes
    nodes.forEach(node => {
      if (node.values?.ticker || node.values?.symbol) {
        symbols.add(node.values.ticker || node.values.symbol);
      }
    });

    // Load historical data for each symbol
    for (const symbol of symbols) {
      try {
        const result = await DataService.execute('yahoofinance', 'get_history', {
          symbol,
          period1: startDate,
          period2: endDate,
          interval: frequency
        });

        if (result.success && result.data?.data) {
          this.historicalData.set(symbol, result.data.data);
        }
      } catch (error) {
        console.error(`Failed to load historical data for ${symbol}:`, error);
      }
    }
  }

  private async simulateBacktest(nodes: WorkflowNode[], edges: WorkflowEdge[], backtest: any): Promise<void> {
    const dates = this.getUniqueDates();
    
    for (const date of dates) {
      // Update market data context for this date
      const marketContext = this.getMarketContextForDate(date);
      
      // Create a modified engine that uses historical data
      const engine = new EngineV2(nodes, edges);
      
      // Register all necessary executors with historical data context
      const executors = await this.createHistoricalExecutors(marketContext);
      executors.forEach(executor => engine.registerExecutor(executor));

      // Run workflow for this date
      const initialInput: Item[] = [{ data: marketContext, metadata: {} }];
      await engine.run(initialInput);

      // Process any trade signals generated
      await this.processTradingSignals(engine, date, backtest);
      
      // Take portfolio snapshot
      this.takePortfolioSnapshot(date);
    }
  }

  private getUniqueDates(): Date[] {
    const allDates = new Set<string>();
    
    this.historicalData.forEach(data => {
      data.forEach(candle => {
        allDates.add(candle.date);
      });
    });

    return Array.from(allDates)
      .map(date => new Date(date))
      .sort((a, b) => a.getTime() - b.getTime());
  }

  private getMarketContextForDate(date: Date): any {
    const context: any = {};
    
    this.historicalData.forEach((data, symbol) => {
      const dayData = data.find(candle => 
        new Date(candle.date).toDateString() === date.toDateString()
      );
      
      if (dayData) {
        context[symbol] = dayData;
      }
    });

    return context;
  }

  private async createHistoricalExecutors(marketContext: any): Promise<any[]> {
    // Create mock executors that use historical data instead of live data
    // This would include modified versions of DataSourceExecutor, IndicatorsExecutor, etc.
    return [];
  }

  private async processTradingSignals(engine: any, date: Date, backtest: any): Promise<void> {
    // Extract trading signals from engine output
    // This would analyze the workflow output for buy/sell signals
    // and execute trades in the simulated portfolio
  }

  private takePortfolioSnapshot(date: Date): void {
    const stockValue = this.calculateStockValue(date);
    const totalValue = this.cash + stockValue;
    
    const prevSnapshot = this.portfolioSnapshots[this.portfolioSnapshots.length - 1];
    const dailyReturn = prevSnapshot ? 
      (totalValue - prevSnapshot.total_value) / prevSnapshot.total_value : 0;

    this.portfolioSnapshots.push({
      date,
      cash_balance: this.cash,
      stock_value: stockValue,
      total_value: totalValue,
      daily_return: dailyReturn
    });
  }

  private calculateStockValue(date: Date): number {
    let totalValue = 0;
    
    this.portfolio.forEach((quantity, symbol) => {
      const historicalData = this.historicalData.get(symbol);
      if (historicalData) {
        const dayData = historicalData.find(candle => 
          new Date(candle.date).toDateString() === date.toDateString()
        );
        
        if (dayData) {
          totalValue += quantity * dayData.close;
        }
      }
    });

    return totalValue;
  }

  private calculatePerformanceMetrics(initialCapital: number): BacktestResult {
    const finalValue = this.portfolioSnapshots[this.portfolioSnapshots.length - 1]?.total_value || initialCapital;
    const totalReturn = (finalValue - initialCapital) / initialCapital;
    
    // Calculate max drawdown
    let maxDrawdown = 0;
    let peak = initialCapital;
    
    this.portfolioSnapshots.forEach(snapshot => {
      if (snapshot.total_value > peak) {
        peak = snapshot.total_value;
      }
      const drawdown = (peak - snapshot.total_value) / peak;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    });

    // Calculate win rate
    const profitableTrades = this.trades.filter(trade => 
      trade.action === 'sell' && this.calculateTradeProfit(trade) > 0
    ).length;
    const totalTrades = this.trades.filter(trade => trade.action === 'sell').length;
    const winRate = totalTrades > 0 ? profitableTrades / totalTrades : 0;

    // Calculate other metrics
    const days = this.portfolioSnapshots.length;
    const annualizedReturn = days > 0 ? Math.pow(1 + totalReturn, 365 / days) - 1 : 0;
    
    const dailyReturns = this.portfolioSnapshots.map(s => s.daily_return);
    const avgDailyReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const stdDailyReturn = Math.sqrt(
      dailyReturns.reduce((sum, ret) => sum + Math.pow(ret - avgDailyReturn, 2), 0) / dailyReturns.length
    );
    const sharpeRatio = stdDailyReturn > 0 ? (avgDailyReturn * Math.sqrt(365)) / (stdDailyReturn * Math.sqrt(365)) : 0;

    const tradeReturns = this.trades
      .filter(trade => trade.action === 'sell')
      .map(trade => this.calculateTradeProfit(trade));
    
    const averageTradeReturn = tradeReturns.length > 0 ? 
      tradeReturns.reduce((a, b) => a + b, 0) / tradeReturns.length : 0;
    
    const largestWin = tradeReturns.length > 0 ? Math.max(...tradeReturns) : 0;
    const largestLoss = tradeReturns.length > 0 ? Math.min(...tradeReturns) : 0;

    return {
      total_return: totalReturn,
      annualized_return: annualizedReturn,
      max_drawdown: maxDrawdown,
      sharpe_ratio: sharpeRatio,
      win_rate: winRate,
      total_trades: totalTrades,
      profitable_trades: profitableTrades,
      average_trade_return: averageTradeReturn,
      largest_win: largestWin,
      largest_loss: largestLoss,
      final_portfolio_value: finalValue
    };
  }

  private calculateTradeProfit(trade: BacktestTrade): number {
    // This would calculate the profit for a completed trade
    // by finding the corresponding buy trade and calculating the difference
    return 0;
  }

  private async saveBacktestResults(
    backtestId: string, 
    results: BacktestResult, 
    trades: BacktestTrade[], 
    snapshots: PortfolioSnapshot[]
  ): Promise<void> {
    // Save main results
    await supabase
      .from('backtest_results')
      .insert({
        backtest_id: backtestId,
        ...results
      });

    // Save trades
    if (trades.length > 0) {
      await supabase
        .from('backtest_trades')
        .insert(
          trades.map(trade => ({
            backtest_id: backtestId,
            ...trade,
            timestamp: trade.timestamp.toISOString()
          }))
        );
    }

    // Save portfolio snapshots
    if (snapshots.length > 0) {
      await supabase
        .from('backtest_portfolio_snapshots')
        .insert(
          snapshots.map(snapshot => ({
            backtest_id: backtestId,
            date: snapshot.date.toISOString().split('T')[0],
            cash_balance: snapshot.cash_balance,
            stock_value: snapshot.stock_value,
            total_value: snapshot.total_value,
            daily_return: snapshot.daily_return
          }))
        );
    }
  }

  async getBacktestResults(backtestId: string, userId: string): Promise<any> {
    try {
      // Get backtest details
      const { data: backtest, error: backtestError } = await supabase
        .from('backtests')
        .select('*')
        .eq('id', backtestId)
        .eq('user_id', userId)
        .single();

      if (backtestError || !backtest) {
        throw createError('Backtest not found', 404);
      }

      // Get results
      const { data: results, error: resultsError } = await supabase
        .from('backtest_results')
        .select('*')
        .eq('backtest_id', backtestId)
        .single();

      // Get trades
      const { data: trades, error: tradesError } = await supabase
        .from('backtest_trades')
        .select('*')
        .eq('backtest_id', backtestId)
        .order('timestamp');

      // Get portfolio snapshots
      const { data: snapshots, error: snapshotsError } = await supabase
        .from('backtest_portfolio_snapshots')
        .select('*')
        .eq('backtest_id', backtestId)
        .order('date');

      return {
        backtest,
        results: results || null,
        trades: trades || [],
        snapshots: snapshots || []
      };
    } catch (error) {
      throw createError(`Failed to get backtest results: ${error instanceof Error ? error.message : 'Unknown error'}`, 500);
    }
  }

  async getUserBacktests(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('backtests')
        .select(`
          *,
          workflows(name),
          backtest_results(total_return, final_portfolio_value)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        throw createError('Failed to get user backtests', 500);
      }

      return data || [];
    } catch (error) {
      throw createError(`Failed to get user backtests: ${error instanceof Error ? error.message : 'Unknown error'}`, 500);
    }
  }
}