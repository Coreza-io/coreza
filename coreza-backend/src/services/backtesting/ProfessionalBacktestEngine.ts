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
    
    // Filter out irrelevant nodes for backtesting
    const allNodes: WorkflowNode[] = workflow.nodes;
    const allEdges: WorkflowEdge[] = workflow.edges;
    
    const filteredNodes = this.filterBacktestingNodes(allNodes);
    const filteredEdges = this.filterBacktestingEdges(allEdges, filteredNodes);
    
    console.log(`Filtered workflow: ${allNodes.length} → ${filteredNodes.length} nodes, ${allEdges.length} → ${filteredEdges.length} edges`);
    
    // Find Alpaca nodes for historical data
    await this.loadHistoricalDataFromWorkflow(filteredNodes);
    
    // Initialize strategy with filtered workflow
    this.strategy = new WorkflowStrategy(filteredNodes, filteredEdges);
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
  
  private filterBacktestingNodes(nodes: WorkflowNode[]): WorkflowNode[] {
    const irrelevantTypes = ['Scheduler', 'Trigger', 'Webhook', 'Chat', 'Gmail', 'WhatsApp'];
    
    return nodes.filter(node => {
      const nodeType = node.type || (node.data?.definition as any)?.name;
      
      // Filter out irrelevant nodes for backtesting
      if (irrelevantTypes.includes(nodeType)) {
        console.log(`🚫 Filtering out ${nodeType} node: ${node.id}`);
        return false;
      }
      
      return true;
    });
  }
  
  private filterBacktestingEdges(edges: WorkflowEdge[], filteredNodes: WorkflowNode[]): WorkflowEdge[] {
    const nodeIds = new Set(filteredNodes.map(n => n.id));
    
    return edges.filter(edge => {
      const hasValidSource = nodeIds.has(edge.source);
      const hasValidTarget = nodeIds.has(edge.target);
      
      if (!hasValidSource || !hasValidTarget) {
        console.log(`🚫 Filtering out edge ${edge.id}: ${edge.source} → ${edge.target}`);
        return false;
      }
      
      return true;
    });
  }
  
  private async loadHistoricalDataFromWorkflow(nodes: WorkflowNode[]): Promise<void> {
    console.log('🔍 Looking for broker data nodes in workflow...');
    
    // Find any broker nodes that can provide historical data
    const dataNodes = nodes.filter(node => {
      const nodeType = node.type || (node.data?.definition as any)?.name;
      const operation = node.values?.operation;
      
      // Check for any broker node with historical data operation
      return (
        (nodeType === 'Alpaca' && operation === 'get_candle') ||
        (nodeType === 'Dhan' && operation === 'get_candle') ||
        (node.category === 'Broker' && ['get_candle', 'get_history', 'get_chart'].includes(operation))
      );
    });
    
    if (dataNodes.length === 0) {
      console.warn('⚠️ No broker historical data nodes found, falling back to Yahoo Finance');
      const symbols = this.extractSymbolsFromWorkflow(nodes);
      await this.loadHistoricalDataFromYahoo(symbols);
      return;
    }
    
    // Use the broker nodes found in workflow to get historical data
    for (const dataNode of dataNodes) {
      try {
        const symbol = dataNode.values?.ticker || dataNode.values?.symbol;
        if (!symbol) continue;
        
        const brokerType = dataNode.type || (dataNode.data?.definition as any)?.name;
        console.log(`📈 Loading ${symbol} data from ${brokerType} node: ${dataNode.id}`);
        
        // Execute the broker node to get historical data
        const result = await this.executeBrokerHistoricalNode(dataNode, brokerType);
        
        if (result && result.data) {
          const marketEvents = this.convertBrokerDataToMarketEvents(symbol, result.data, brokerType);
          this.eventQueue.loadMarketData(symbol, marketEvents);
          console.log(`✅ Loaded ${marketEvents.length} data points for ${symbol} from ${brokerType}`);
        }
      } catch (error) {
        console.error(`❌ Failed to load ${dataNode.type} data for node ${dataNode.id}:`, error);
      }
    }
  }
  
  private async executeBrokerHistoricalNode(brokerNode: WorkflowNode, brokerType: string): Promise<any> {
    // Import the BrokerService dynamically
    const { BrokerService } = await import('../brokers');
    
    // Prepare parameters for historical data request
    const params = {
      ...brokerNode.values,
      user_id: this.config.user_id,
      operation: brokerNode.values?.operation || 'get_candle',
      start: this.config.start_date,
      end: this.config.end_date,
      timeframe: this.mapFrequencyToBrokerTimeframe(this.config.data_frequency, brokerType)
    };
    
    // Use the appropriate broker service
    const serviceKey = brokerType.toLowerCase();
    return await BrokerService.execute(serviceKey, params);
  }
  
  private mapFrequencyToBrokerTimeframe(frequency: string, brokerType: string): string {
    // Common mapping for most brokers
    const commonMapping: Record<string, string> = {
      '1m': '1Min',
      '5m': '5Min', 
      '15m': '15Min',
      '30m': '30Min',
      '1h': '1Hour',
      '1d': '1Day',
      '1w': '1Week',
      '1mo': '1Month'
    };
    
    // Broker-specific mappings if needed
    if (brokerType.toLowerCase() === 'dhan') {
      return commonMapping[frequency] || 'Daily';
    }
    
    return commonMapping[frequency] || '1Day';
  }
  
  private convertBrokerDataToMarketEvents(symbol: string, brokerData: any, brokerType: string): MarketDataEvent[] {
    // Handle different broker data formats
    const dataArray = Array.isArray(brokerData) ? brokerData : 
                     brokerData.candles || brokerData.data || brokerData.bars || [brokerData];
    
    return dataArray.map((candle: any) => ({
      type: 'MARKET_DATA' as const,
      timestamp: new Date(candle.timestamp || candle.t || candle.time || candle.date),
      symbol,
      open: candle.open || candle.o,
      high: candle.high || candle.h, 
      low: candle.low || candle.l,
      close: candle.close || candle.c,
      volume: candle.volume || candle.v,
      adj_close: candle.close || candle.c || candle.adj_close
    }));
  }
  
  private async loadHistoricalDataFromYahoo(symbols: string[]): Promise<void> {
    console.log(`📊 Loading historical data from Yahoo Finance for: ${symbols.join(', ')}`);
    
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
          console.log(`✅ Loaded ${marketEvents.length} data points for ${symbol} from Yahoo`);
        }
      } catch (error) {
        console.error(`❌ Failed to load Yahoo data for ${symbol}:`, error);
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