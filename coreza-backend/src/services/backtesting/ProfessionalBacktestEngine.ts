import { supabase } from '../../config/supabase';
import { DataService } from '../data';
import { EventQueue } from './EventQueue';
import { PortfolioManager } from './PortfolioManager';
import { ExecutionHandler, SimpleSlippageModel } from './ExecutionHandler';
import { PerformanceAnalyzer } from './PerformanceAnalyzer';
import { WorkflowStrategy } from './StrategyEngine';
import { 
  BacktestConfig, 
  MarketDataEvent, 
  SignalEvent, 
  OrderEvent, 
  FillEvent,
  PerformanceMetrics 
} from './types';
import { WorkflowNode, WorkflowEdge } from '../../nodes/types';
import { createError } from '../../middleware/errorHandler';

export class ProfessionalBacktestEngine {
  private eventQueue: EventQueue;
  private portfolio: PortfolioManager;
  private executionHandler: ExecutionHandler;
  private strategy: WorkflowStrategy | null = null;
  
  private config: BacktestConfig;
  private backtestId: string;
  
  // Performance tracking
  private allTrades: FillEvent[] = [];
  private allSignals: SignalEvent[] = [];
  private allOrders: OrderEvent[] = [];
  
  constructor(config: BacktestConfig, backtestId: string) {
    this.config = config;
    this.backtestId = backtestId;
    
    // Initialize components
    this.eventQueue = new EventQueue();
    this.portfolio = new PortfolioManager(
      config.initial_capital,
      (quantity, price) => Math.max(1.0, quantity * price * config.commission_rate)
    );
    this.executionHandler = new ExecutionHandler(
      (quantity, price) => Math.max(1.0, quantity * price * config.commission_rate),
      new SimpleSlippageModel(config.slippage_rate)
    );
  }
  
  // Main backtest execution method
  async run(): Promise<PerformanceMetrics> {
    console.log(`Starting backtest ${this.backtestId}`);
    
    try {
      // 1. Load workflow and historical data
      await this.loadWorkflowAndData();
      
      // 2. Initialize strategy
      if (!this.strategy) {
        throw new Error('Strategy not initialized');
      }
      this.strategy.initialize();
      
      // 3. Run main event loop
      await this.runEventLoop();
      
      // 4. Calculate performance metrics
      const metrics = this.calculatePerformance();
      
      // 5. Save results to database
      await this.saveResults(metrics);
      
      console.log(`Backtest ${this.backtestId} completed successfully`);
      return metrics;
      
    } catch (error) {
      console.error(`Backtest ${this.backtestId} failed:`, error);
      await this.updateBacktestStatus('failed', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }
  
  private async loadWorkflowAndData(): Promise<void> {
    // Load workflow configuration
    const { data: workflow, error: workflowError } = await supabase
      .from('workflows')
      .select('nodes, edges')
      .eq('id', this.config.workflow_id)
      .single();
    
    if (workflowError || !workflow) {
      throw new Error('Failed to load workflow');
    }
    
    const nodes: WorkflowNode[] = workflow.nodes;
    const edges: WorkflowEdge[] = workflow.edges;
    
    // Extract symbols from workflow
    const symbols = this.extractSymbolsFromWorkflow(nodes);
    
    // Load historical data for each symbol
    await this.loadHistoricalData(symbols);
    
    // Initialize strategy
    this.strategy = new WorkflowStrategy(nodes, edges);
  }
  
  private extractSymbolsFromWorkflow(nodes: WorkflowNode[]): string[] {
    const symbols = new Set<string>();
    
    nodes.forEach(node => {
      // Extract symbols from various node types
      if (node.values?.ticker) symbols.add(node.values.ticker);
      if (node.values?.symbol) symbols.add(node.values.symbol);
      if (node.values?.instruments) {
        node.values.instruments.forEach((instrument: string) => symbols.add(instrument));
      }
    });
    
    return Array.from(symbols);
  }
  
  private async loadHistoricalData(symbols: string[]): Promise<void> {
    console.log(`Loading historical data for symbols: ${symbols.join(', ')}`);
    
    for (const symbol of symbols) {
      try {
        const result = await DataService.execute('yahoofinance', 'get_history', {
          symbol,
          period1: this.config.start_date,
          period2: this.config.end_date,
          interval: this.config.data_frequency
        });
        
        if (result.success && result.data?.data) {
          const marketEvents: MarketDataEvent[] = result.data.data.map((candle: any) => ({
            type: 'MARKET_DATA' as const,
            timestamp: new Date(candle.date),
            symbol,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
            adj_close: candle.adjClose
          }));
          
          this.eventQueue.loadMarketData(symbol, marketEvents);
          console.log(`Loaded ${marketEvents.length} data points for ${symbol}`);
        }
      } catch (error) {
        console.error(`Failed to load data for ${symbol}:`, error);
      }
    }
  }
  
  private async runEventLoop(): Promise<void> {
    let eventCount = 0;
    let lastProgressUpdate = Date.now();
    
    console.log(`Starting event loop with ${this.eventQueue.size()} events`);
    
    // Main event processing loop
    while (!this.eventQueue.isEmpty()) {
      const event = this.eventQueue.dequeue();
      if (!event) break;
      
      eventCount++;
      
      // Update progress periodically
      if (Date.now() - lastProgressUpdate > 5000) { // Every 5 seconds
        await this.updateProgress(eventCount);
        lastProgressUpdate = Date.now();
      }
      
      // Process event based on type
      switch (event.type) {
        case 'MARKET_DATA':
          await this.handleMarketData(event as MarketDataEvent);
          break;
        case 'SIGNAL':
          await this.handleSignal(event as SignalEvent);
          break;
        case 'ORDER':
          await this.handleOrder(event as OrderEvent);
          break;
        case 'FILL':
          await this.handleFill(event as FillEvent);
          break;
      }
    }
    
    console.log(`Event loop completed. Processed ${eventCount} events.`);
  }
  
  private async handleMarketData(event: MarketDataEvent): Promise<void> {
    if (!this.strategy) return;
    
    // Update portfolio with current market prices
    this.portfolio.updatePortfolioValue(event.timestamp, this.eventQueue);
    
    // Generate trading signals from strategy
    const signals = this.strategy.onMarketData(event);
    
    // Process each signal
    for (const signal of signals) {
      this.allSignals.push(signal);
      this.eventQueue.enqueue(signal);
    }
  }
  
  private async handleSignal(signal: SignalEvent): Promise<void> {
    if (!this.strategy) return;
    
    // Convert signal to order with position sizing
    const portfolioValue = this.portfolio.getTotalValue();
    const currentPrice = this.eventQueue.getCurrentPrice(signal.symbol, signal.timestamp);
    
    if (!currentPrice) return;
    
    // Calculate position size (risk management)
    const positionSize = this.strategy.calculatePositionSize(
      signal, 
      portfolioValue, 
      currentPrice
    );
    
    if (positionSize > 0) {
      // Check if we can afford the trade
      const canAfford = this.portfolio.canAffordTrade(signal.symbol, positionSize, currentPrice);
      
      if (canAfford) {
        const order = this.strategy.signalToOrder(signal, positionSize);
        this.allOrders.push(order);
        this.eventQueue.enqueue(order);
      }
    }
  }
  
  private async handleOrder(order: OrderEvent): Promise<void> {
    // Execute order through execution handler
    const fill = this.executionHandler.executeOrder(order, this.eventQueue);
    
    if (fill) {
      this.allTrades.push(fill);
      this.eventQueue.enqueue(fill);
    }
  }
  
  private async handleFill(fill: FillEvent): Promise<void> {
    // Update portfolio with fill
    this.portfolio.processFill(fill, this.eventQueue);
    
    // Log significant fills
    if (fill.quantity * fill.fill_price > 1000) {
      console.log(`Large fill: ${fill.direction} ${fill.quantity} ${fill.symbol} @ $${fill.fill_price.toFixed(2)}`);
    }
  }
  
  private calculatePerformance(): PerformanceMetrics {
    const portfolio = this.portfolio.getPortfolio();
    return PerformanceAnalyzer.calculateMetrics(
      portfolio,
      this.config.initial_capital,
      0.02 // 2% risk-free rate
    );
  }
  
  private async saveResults(metrics: PerformanceMetrics): Promise<void> {
    try {
      // Save main performance metrics
      await supabase
        .from('backtest_results')
        .insert({
          backtest_id: this.backtestId,
          total_return: metrics.total_return,
          annualized_return: metrics.annualized_return,
          max_drawdown: metrics.max_drawdown,
          sharpe_ratio: metrics.sharpe_ratio,
          win_rate: metrics.win_rate,
          total_trades: metrics.total_trades,
          profitable_trades: metrics.winning_trades,
          average_trade_return: metrics.avg_trade_pnl,
          largest_win: metrics.largest_win,
          largest_loss: metrics.largest_loss,
          final_portfolio_value: this.portfolio.getTotalValue()
        });
      
      // Save trade history
      if (this.allTrades.length > 0) {
        const tradeRecords = this.allTrades.map(trade => ({
          backtest_id: this.backtestId,
          symbol: trade.symbol,
          action: trade.direction.toLowerCase(),
          quantity: trade.quantity,
          price: trade.fill_price,
          timestamp: trade.timestamp.toISOString(),
          commission: trade.commission,
          slippage: trade.slippage,
          portfolio_value_before: 0, // Would need to track this
          portfolio_value_after: 0   // Would need to track this
        }));
        
        await supabase
          .from('backtest_trades')
          .insert(tradeRecords);
      }
      
      // Save portfolio snapshots
      const portfolio = this.portfolio.getPortfolio();
      if (portfolio.equity_curve.length > 0) {
        const snapshots = portfolio.equity_curve.map((point, index) => ({
          backtest_id: this.backtestId,
          date: point.date.toISOString().split('T')[0],
          cash_balance: this.portfolio.getAvailableCash(),
          stock_value: point.value - this.portfolio.getAvailableCash(),
          total_value: point.value,
          daily_return: portfolio.daily_returns[index] || 0
        }));
        
        await supabase
          .from('backtest_portfolio_snapshots')
          .insert(snapshots);
      }
      
      // Update backtest status
      await this.updateBacktestStatus('completed');
      
    } catch (error) {
      console.error('Failed to save backtest results:', error);
      throw error;
    }
  }
  
  private async updateBacktestStatus(status: string, errorMessage?: string): Promise<void> {
    const updateData: any = {
      status,
      completed_at: new Date().toISOString()
    };
    
    if (errorMessage) {
      updateData.error_message = errorMessage;
    }
    
    await supabase
      .from('backtests')
      .update(updateData)
      .eq('id', this.backtestId);
  }
  
  private async updateProgress(eventCount: number): Promise<void> {
    // Could update a progress field in the database
    console.log(`Processed ${eventCount} events...`);
  }
  
  // Get current backtest state for monitoring
  getBacktestState(): any {
    return {
      eventsProcessed: this.eventQueue.size(),
      totalTrades: this.allTrades.length,
      totalSignals: this.allSignals.length,
      portfolioValue: this.portfolio.getTotalValue(),
      portfolioSummary: this.portfolio.getPortfolioSummary()
    };
  }
}