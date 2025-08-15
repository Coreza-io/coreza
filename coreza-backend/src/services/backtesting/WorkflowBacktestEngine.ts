import { supabase } from '../../config/supabase';
import { EventQueue } from './EventQueue';
import { PortfolioManager } from './PortfolioManager';
import { ExecutionHandler, SimpleSlippageModel } from './ExecutionHandler';
import { PerformanceAnalyzer } from './PerformanceAnalyzer';
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
import { NodeExecutor } from '../../nodes/registry';

export class WorkflowBacktestEngine {
  private eventQueue: EventQueue;
  private portfolio: PortfolioManager;
  private executionHandler: ExecutionHandler;
  
  private config: BacktestConfig;
  private backtestId: string;
  
  private nodes: WorkflowNode[] = [];
  private edges: WorkflowEdge[] = [];
  private nodeResults: Map<string, any> = new Map();
  private extractedSymbols: Set<string> = new Set();
  
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
  
  async run(): Promise<PerformanceMetrics> {
    console.log(`🚀 Starting workflow-driven backtest ${this.backtestId}`);
    
    try {
      // Phase 1: Load and prepare workflow
      await this.loadWorkflow();
      
      // Phase 2: Execute non-market nodes to extract symbols
      await this.executeSymbolExtractionPhase();
      
      // Phase 3: Load historical data for extracted symbols
      await this.loadHistoricalDataForSymbols();
      
      // Phase 4: Run full workflow simulation
      await this.runWorkflowSimulation();
      
      // Phase 5: Calculate and save results
      const metrics = this.calculatePerformance();
      await this.saveResults(metrics);
      
      console.log(`✅ Backtest ${this.backtestId} completed successfully`);
      return metrics;
      
    } catch (error) {
      console.error(`❌ Backtest ${this.backtestId} failed:`, error);
      await this.updateBacktestStatus('failed', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }
  
  private async loadWorkflow(): Promise<void> {
    console.log('📋 Loading workflow configuration...');
    
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
    
    this.nodes = this.filterBacktestingNodes(allNodes);
    this.edges = this.filterBacktestingEdges(allEdges, this.nodes);
    
    console.log(`🔧 Filtered workflow: ${allNodes.length} → ${this.nodes.length} nodes, ${allEdges.length} → ${this.edges.length} edges`);
  }
  
  private filterBacktestingNodes(nodes: WorkflowNode[]): WorkflowNode[] {
    const irrelevantTypes = ['Scheduler', 'Trigger', 'Webhook', 'Chat', 'Gmail', 'WhatsApp'];
    
    return nodes.filter(node => {
      const nodeType = node.type || (node.data?.definition as any)?.name;
      
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
  
  private async executeSymbolExtractionPhase(): Promise<void> {
    console.log('🔍 Phase 1: Executing workflow to extract symbols...');
    
    // Find starting nodes (nodes with no incoming edges)
    const startingNodes = this.findStartingNodes();
    console.log(`📍 Found ${startingNodes.length} starting nodes:`, startingNodes.map(n => n.id));
    
    // Execute nodes that don't depend on market data to extract symbols
    const nonMarketNodes = this.nodes.filter(node => !this.isMarketDataNode(node));
    
    for (const node of nonMarketNodes) {
      if (this.canExecuteNode(node)) {
        try {
          const result = await this.executeNode(node);
          this.nodeResults.set(node.id, result);
          this.extractSymbolsFromResult(result);
          console.log(`✅ Executed ${node.type} node ${node.id}, extracted symbols:`, Array.from(this.extractedSymbols));
        } catch (error) {
          console.error(`❌ Failed to execute node ${node.id}:`, error);
        }
      }
    }
    
    // Also extract static symbols from node configurations
    this.extractStaticSymbols();
    
    console.log(`🎯 Total symbols extracted: ${this.extractedSymbols.size}:`, Array.from(this.extractedSymbols));
  }
  
  private findStartingNodes(): WorkflowNode[] {
    const hasIncomingEdge = new Set(this.edges.map(e => e.target));
    return this.nodes.filter(node => !hasIncomingEdge.has(node.id));
  }
  
  private isMarketDataNode(node: WorkflowNode): boolean {
    const nodeType = node.type || (node.data?.definition as any)?.name;
    const operation = node.values?.operation;
    
    return (
      (nodeType === 'Alpaca' && ['get_candle', 'get_history'].includes(operation)) ||
      (nodeType === 'Dhan' && ['get_candle', 'get_history'].includes(operation)) ||
      (nodeType === 'YahooFinance' && operation === 'get_history') ||
      (node.category === 'Broker' && ['get_candle', 'get_history', 'get_chart'].includes(operation))
    );
  }
  
  private canExecuteNode(node: WorkflowNode): boolean {
    // Check if all dependencies are satisfied
    const incomingEdges = this.edges.filter(e => e.target === node.id);
    
    for (const edge of incomingEdges) {
      if (!this.nodeResults.has(edge.source)) {
        return false;
      }
    }
    
    return true;
  }
  
  private async executeNode(node: WorkflowNode): Promise<any> {
    const nodeType = node.type || (node.data?.definition as any)?.name;
    
    // Prepare node inputs from previous node results
    const inputs = this.prepareNodeInputs(node);
    
    // Execute the node
    try {
      const executor = NodeExecutor.getExecutor(nodeType);
      if (!executor) {
        throw new Error(`No executor found for node type: ${nodeType}`);
      }
      
      const result = await executor.execute({
        ...node.values,
        ...inputs,
        user_id: this.config.user_id
      });
      
      return result;
    } catch (error) {
      console.error(`Failed to execute ${nodeType} node ${node.id}:`, error);
      throw error;
    }
  }
  
  private prepareNodeInputs(node: WorkflowNode): any {
    const inputs: any = {};
    
    // Get data from incoming edges
    const incomingEdges = this.edges.filter(e => e.target === node.id);
    
    for (const edge of incomingEdges) {
      const sourceResult = this.nodeResults.get(edge.source);
      if (sourceResult) {
        // Map the result to the appropriate input field
        inputs[edge.targetHandle || 'data'] = sourceResult;
      }
    }
    
    return inputs;
  }
  
  private extractSymbolsFromResult(result: any): void {
    if (!result) return;
    
    // Extract symbols from various result formats
    if (typeof result === 'string') {
      // Single symbol as string
      this.extractedSymbols.add(result.toUpperCase());
    } else if (Array.isArray(result)) {
      // Array of symbols or objects
      result.forEach(item => {
        if (typeof item === 'string') {
          this.extractedSymbols.add(item.toUpperCase());
        } else if (item.symbol) {
          this.extractedSymbols.add(item.symbol.toUpperCase());
        } else if (item.ticker) {
          this.extractedSymbols.add(item.ticker.toUpperCase());
        }
      });
    } else if (typeof result === 'object') {
      // Object with symbol properties
      if (result.symbol) this.extractedSymbols.add(result.symbol.toUpperCase());
      if (result.ticker) this.extractedSymbols.add(result.ticker.toUpperCase());
      if (result.symbols && Array.isArray(result.symbols)) {
        result.symbols.forEach((symbol: string) => this.extractedSymbols.add(symbol.toUpperCase()));
      }
    }
  }
  
  private extractStaticSymbols(): void {
    // Extract symbols from node configurations
    this.nodes.forEach(node => {
      if (node.values?.ticker) this.extractedSymbols.add(node.values.ticker.toUpperCase());
      if (node.values?.symbol) this.extractedSymbols.add(node.values.symbol.toUpperCase());
      if (node.values?.instruments && Array.isArray(node.values.instruments)) {
        node.values.instruments.forEach((instrument: string) => 
          this.extractedSymbols.add(instrument.toUpperCase())
        );
      }
    });
  }
  
  private async loadHistoricalDataForSymbols(): Promise<void> {
    console.log('📈 Phase 2: Loading historical data for extracted symbols...');
    
    if (this.extractedSymbols.size === 0) {
      throw new Error('No symbols extracted from workflow');
    }
    
    const symbols = Array.from(this.extractedSymbols);
    
    // Find the best data source node in the workflow
    const dataNode = this.findBestDataSourceNode();
    
    for (const symbol of symbols) {
      try {
        if (dataNode) {
          await this.loadDataFromWorkflowNode(symbol, dataNode);
        } else {
          await this.loadDataFromYahooFinance(symbol);
        }
      } catch (error) {
        console.error(`❌ Failed to load data for ${symbol}:`, error);
      }
    }
  }
  
  private findBestDataSourceNode(): WorkflowNode | null {
    // Priority: Alpaca > Dhan > Other brokers > Yahoo
    const brokerPriority = ['Alpaca', 'Dhan', 'YahooFinance'];
    
    for (const brokerType of brokerPriority) {
      const node = this.nodes.find(node => {
        const nodeType = node.type || (node.data?.definition as any)?.name;
        const operation = node.values?.operation;
        return nodeType === brokerType && ['get_candle', 'get_history'].includes(operation);
      });
      
      if (node) {
        console.log(`🎯 Using ${brokerType} as data source`);
        return node;
      }
    }
    
    return null;
  }
  
  private async loadDataFromWorkflowNode(symbol: string, dataNode: WorkflowNode): Promise<void> {
    const nodeType = dataNode.type || (dataNode.data?.definition as any)?.name;
    
    // Create a copy of the node with the specific symbol
    const dataNodeCopy = {
      ...dataNode,
      values: {
        ...dataNode.values,
        symbol,
        ticker: symbol,
        start: this.config.start_date,
        end: this.config.end_date,
        timeframe: this.mapFrequencyToBrokerTimeframe(this.config.data_frequency, nodeType)
      }
    };
    
    try {
      const result = await this.executeNode(dataNodeCopy);
      
      if (result && result.data) {
        const marketEvents = this.convertBrokerDataToMarketEvents(symbol, result.data, nodeType);
        this.eventQueue.loadMarketData(symbol, marketEvents);
        console.log(`✅ Loaded ${marketEvents.length} data points for ${symbol} from ${nodeType}`);
      }
    } catch (error) {
      console.error(`❌ Failed to load ${nodeType} data for ${symbol}:`, error);
      throw error;
    }
  }
  
  private async loadDataFromYahooFinance(symbol: string): Promise<void> {
    console.log(`📊 Loading ${symbol} from Yahoo Finance fallback`);
    
    // Import DataService dynamically
    const { DataService } = await import('../data');
    
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
      throw error;
    }
  }
  
  private mapFrequencyToBrokerTimeframe(frequency: string, brokerType: string): string {
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
    
    return commonMapping[frequency] || '1Day';
  }
  
  private convertBrokerDataToMarketEvents(symbol: string, brokerData: any, brokerType: string): MarketDataEvent[] {
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
  
  private async runWorkflowSimulation(): Promise<void> {
    console.log('🔄 Phase 3: Running workflow simulation...');
    
    let eventCount = 0;
    let lastProgressUpdate = Date.now();
    
    console.log(`Starting simulation with ${this.eventQueue.size()} market events`);
    
    // Reset node results for simulation phase
    this.nodeResults.clear();
    
    // Main simulation loop - process each market data event
    while (!this.eventQueue.isEmpty()) {
      const event = this.eventQueue.dequeue();
      if (!event) break;
      
      eventCount++;
      
      // Update progress periodically
      if (Date.now() - lastProgressUpdate > 5000) {
        await this.updateProgress(eventCount);
        lastProgressUpdate = Date.now();
      }
      
      // Process event based on type
      switch (event.type) {
        case 'MARKET_DATA':
          await this.processMarketDataEvent(event as MarketDataEvent);
          break;
        case 'SIGNAL':
          await this.processSignalEvent(event as SignalEvent);
          break;
        case 'ORDER':
          await this.processOrderEvent(event as OrderEvent);
          break;
        case 'FILL':
          await this.processFillEvent(event as FillEvent);
          break;
      }
    }
    
    console.log(`✅ Simulation completed. Processed ${eventCount} events.`);
  }
  
  private async processMarketDataEvent(marketEvent: MarketDataEvent): Promise<void> {
    // Update portfolio with current market prices
    this.portfolio.updatePortfolioValue(marketEvent.timestamp, this.eventQueue);
    
    // Execute workflow nodes that depend on this market data
    await this.executeWorkflowForMarketData(marketEvent);
  }
  
  private async executeWorkflowForMarketData(marketEvent: MarketDataEvent): Promise<void> {
    // Find market data nodes that should receive this event
    const marketDataNodes = this.nodes.filter(node => {
      const nodeType = node.type || (node.data?.definition as any)?.name;
      const symbol = node.values?.ticker || node.values?.symbol;
      
      return this.isMarketDataNode(node) && 
             (symbol === marketEvent.symbol || !symbol); // Match symbol or accept all
    });
    
    // Execute market data nodes
    for (const node of marketDataNodes) {
      try {
        // Inject current market data into node
        const nodeWithMarketData = {
          ...node,
          values: {
            ...node.values,
            current_price: marketEvent.close,
            current_timestamp: marketEvent.timestamp,
            market_data: marketEvent
          }
        };
        
        const result = await this.executeNode(nodeWithMarketData);
        this.nodeResults.set(node.id, result);
        
        // Propagate result to downstream nodes
        await this.propagateToDownstreamNodes(node.id, result);
        
      } catch (error) {
        console.error(`❌ Failed to execute market data node ${node.id}:`, error);
      }
    }
  }
  
  private async propagateToDownstreamNodes(sourceNodeId: string, result: any): Promise<void> {
    const outgoingEdges = this.edges.filter(e => e.source === sourceNodeId);
    
    for (const edge of outgoingEdges) {
      const targetNode = this.nodes.find(n => n.id === edge.target);
      if (!targetNode) continue;
      
      // Check if target node can be executed now
      if (this.canExecuteNode(targetNode)) {
        try {
          const nodeResult = await this.executeNode(targetNode);
          this.nodeResults.set(targetNode.id, nodeResult);
          
          // Check if this result generates trading signals
          this.processNodeResultForSignals(targetNode, nodeResult);
          
          // Continue propagation
          await this.propagateToDownstreamNodes(targetNode.id, nodeResult);
          
        } catch (error) {
          console.error(`❌ Failed to execute downstream node ${targetNode.id}:`, error);
        }
      }
    }
  }
  
  private processNodeResultForSignals(node: WorkflowNode, result: any): void {
    // Check if result indicates a trading signal
    if (this.isTradeSignal(result)) {
      const signal = this.convertToSignalEvent(node, result);
      if (signal) {
        this.allSignals.push(signal);
        this.eventQueue.enqueue(signal);
      }
    }
  }
  
  private isTradeSignal(result: any): boolean {
    if (!result || typeof result !== 'object') return false;
    
    return (
      result.action && ['buy', 'sell', 'long', 'short'].includes(result.action.toLowerCase()) ||
      result.signal && ['buy', 'sell', 'long', 'short'].includes(result.signal.toLowerCase()) ||
      result.trade_action ||
      result.order_type
    );
  }
  
  private convertToSignalEvent(node: WorkflowNode, result: any): SignalEvent | null {
    const symbol = result.symbol || result.ticker || node.values?.symbol || node.values?.ticker;
    const action = result.action || result.signal || result.trade_action;
    
    if (!symbol || !action) return null;
    
    return {
      type: 'SIGNAL' as const,
      timestamp: new Date(),
      symbol: symbol.toUpperCase(),
      direction: action.toLowerCase().includes('buy') || action.toLowerCase().includes('long') ? 'LONG' : 'SHORT',
      strength: result.confidence || result.strength || 1.0,
      price: result.price || result.target_price,
      metadata: {
        node_id: node.id,
        node_type: node.type,
        original_result: result
      }
    };
  }
  
  private async processSignalEvent(signal: SignalEvent): Promise<void> {
    // Convert signal to order with position sizing
    const portfolioValue = this.portfolio.getTotalValue();
    const currentPrice = this.eventQueue.getCurrentPrice(signal.symbol, signal.timestamp);
    
    if (!currentPrice) return;
    
    // Simple position sizing (can be made more sophisticated)
    const riskPercentage = 0.02; // 2% risk per trade
    const positionValue = portfolioValue * riskPercentage;
    const positionSize = Math.floor(positionValue / currentPrice);
    
    if (positionSize > 0) {
      const canAfford = this.portfolio.canAffordTrade(signal.symbol, positionSize, currentPrice);
      
      if (canAfford) {
        const order: OrderEvent = {
          type: 'ORDER' as const,
          timestamp: signal.timestamp,
          symbol: signal.symbol,
          direction: signal.direction,
          order_type: 'MARKET',
          quantity: positionSize,
          price: currentPrice
        };
        
        this.allOrders.push(order);
        this.eventQueue.enqueue(order);
      }
    }
  }
  
  private async processOrderEvent(order: OrderEvent): Promise<void> {
    const fill = this.executionHandler.executeOrder(order, this.eventQueue);
    
    if (fill) {
      this.allTrades.push(fill);
      this.eventQueue.enqueue(fill);
    }
  }
  
  private async processFillEvent(fill: FillEvent): Promise<void> {
    this.portfolio.processFill(fill, this.eventQueue);
    
    if (fill.quantity * fill.fill_price > 1000) {
      console.log(`💰 Large fill: ${fill.direction} ${fill.quantity} ${fill.symbol} @ $${fill.fill_price.toFixed(2)}`);
    }
  }
  
  private calculatePerformance(): PerformanceMetrics {
    const portfolio = this.portfolio.getPortfolio();
    return PerformanceAnalyzer.calculateMetrics(
      portfolio,
      this.config.initial_capital,
      0.02
    );
  }
  
  private async saveResults(metrics: PerformanceMetrics): Promise<void> {
    try {
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
          portfolio_value_before: 0,
          portfolio_value_after: 0
        }));
        
        await supabase
          .from('backtest_trades')
          .insert(tradeRecords);
      }
      
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
    console.log(`📊 Processed ${eventCount} events...`);
  }
}
