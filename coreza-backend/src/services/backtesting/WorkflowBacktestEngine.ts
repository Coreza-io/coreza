import { BacktestConfig, BacktestResult } from './types';
import { WorkflowEngine } from '../workflowEngine';
import { WorkflowNode, WorkflowEdge } from '../../nodes/types';
import { DataService } from '../data';

export class WorkflowBacktestEngine {
  private portfolio: { cash: number; positions: Map<string, { quantity: number; avgPrice: number }> };
  private trades: any[] = [];
  private portfolioHistory: Array<{ date: string; value: number; daily_return: number }> = [];

  constructor(
    private config: BacktestConfig,
    private nodes: WorkflowNode[],
    private edges: WorkflowEdge[]
  ) {
    this.portfolio = {
      cash: config.initial_capital,
      positions: new Map()
    };
  }

  async run(): Promise<BacktestResult> {
    console.log('🚀 Starting workflow backtest - simulating autoexecute...');

    // Filter out irrelevant nodes (like Scheduler, Webhook, etc.)
    const relevantNodes = this.filterRelevantNodes();
    const relevantEdges = this.filterRelevantEdges(relevantNodes);

    console.log(`📊 Filtered to ${relevantNodes.length} relevant nodes (from ${this.nodes.length} total)`);

    // Find symbols by running workflow once
    const symbols = await this.extractSymbolsFromWorkflow(relevantNodes, relevantEdges);
    console.log('🎯 Detected symbols:', symbols);

    if (symbols.length === 0) {
      throw new Error('No trading symbols detected in workflow');
    }

    // Load historical data
    const marketData = await this.loadHistoricalData(symbols);

    // Run simulation candle by candle
    await this.simulateWorkflowExecution(relevantNodes, relevantEdges, marketData);

    return this.calculateResults();
  }

  private filterRelevantNodes(): WorkflowNode[] {
    // Filter out nodes that are not relevant for backtesting
    const irrelevantTypes = [
      'Scheduler', 'trigger', 'webhook', 'httprequest', 'Visualize',
      'Gmail', 'WhatsApp', 'ChatInput'
    ];

    return this.nodes.filter(node => !irrelevantTypes.includes(node.type));
  }

  private filterRelevantEdges(relevantNodes: WorkflowNode[]): WorkflowEdge[] {
    const relevantNodeIds = new Set(relevantNodes.map(n => n.id));
    return this.edges.filter(edge => 
      relevantNodeIds.has(edge.source) && relevantNodeIds.has(edge.target)
    );
  }

  private async extractSymbolsFromWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[]): Promise<string[]> {
    console.log('🔍 Running workflow once to extract symbols...');
    
    try {
      const engine = new WorkflowEngine(
        'symbol-extraction',
        this.config.workflow_id,
        this.config.user_id,
        nodes,
        edges
      );

      // Register executors for the workflow engine if needed
      // Note: The engine should have default executors

      const result = await engine.execute({});
      console.log('📋 Symbol extraction result:', result);
      
      const symbols = new Set<string>();
      
      if (result.success && result.result) {
        this.extractSymbolsFromResults(result.result, symbols);
      }

      // If no symbols found, look in node configurations
      if (symbols.size === 0) {
        nodes.forEach(node => {
          if (node.values?.symbol) {
            symbols.add(node.values.symbol);
          }
          if (node.values?.symbols && Array.isArray(node.values.symbols)) {
            node.values.symbols.forEach(s => symbols.add(s));
          }
        });
      }

      // Default fallback
      if (symbols.size === 0) {
        console.warn('⚠️ No symbols found, using default AAPL');
        symbols.add('AAPL');
      }

      return Array.from(symbols);
    } catch (error) {
      console.error('❌ Error extracting symbols:', error);
      return ['AAPL']; // Fallback
    }
  }

  private extractSymbolsFromResults(results: any, symbols: Set<string>): void {
    if (typeof results === 'string' && results.match(/^[A-Z]{1,5}$/)) {
      symbols.add(results);
    } else if (Array.isArray(results)) {
      results.forEach(item => this.extractSymbolsFromResults(item, symbols));
    } else if (results && typeof results === 'object') {
      Object.entries(results).forEach(([key, value]) => {
        if (key.toLowerCase().includes('symbol') && typeof value === 'string') {
          symbols.add(value);
        }
        this.extractSymbolsFromResults(value, symbols);
      });
    }
  }

  private async loadHistoricalData(symbols: string[]): Promise<Map<string, any[]>> {
    console.log('📈 Loading historical data...');
    const marketData = new Map<string, any[]>();
    
    for (const symbol of symbols) {
      try {
        // Use whatever data source is in the workflow (prefer broker nodes)
        const brokerNode = this.nodes.find(n => 
          ['Alpaca', 'Dhan', 'Broker'].includes(n.category) || 
          ['Alpaca', 'Dhan'].includes(n.type)
        );

        let result;
        if (brokerNode) {
          console.log(`📊 Using ${brokerNode.type} for ${symbol} historical data`);
          // TODO: Use broker service for historical data
          result = await DataService.execute(brokerNode.type, 'get_historical', {
            symbol,
            start_date: this.config.start_date,
            end_date: this.config.end_date,
            interval: this.config.data_frequency || '1d'
          });
        } else {
          console.log(`📊 Using YahooFinance for ${symbol} historical data`);
          result = await DataService.execute('yahoofinance', 'get_historical', {
            symbol,
            start_date: this.config.start_date,
            end_date: this.config.end_date,
            interval: this.config.data_frequency || '1d'
          });
        }

        if (result.success && result.data && Array.isArray(result.data)) {
          marketData.set(symbol, result.data);
          console.log(`✅ Loaded ${result.data.length} candles for ${symbol}`);
        }
      } catch (error) {
        console.error(`❌ Failed to load data for ${symbol}:`, error);
      }
    }

    return marketData;
  }

  private async simulateWorkflowExecution(
    nodes: WorkflowNode[], 
    edges: WorkflowEdge[], 
    marketData: Map<string, any[]>
  ): Promise<void> {
    console.log('🎮 Starting candle-by-candle simulation (like autoexecute)...');

    // Get all unique timestamps across all symbols
    const allTimestamps = new Set<string>();
    marketData.forEach(data => {
      data.forEach(candle => {
        if (candle.date) allTimestamps.add(candle.date);
      });
    });

    const sortedTimestamps = Array.from(allTimestamps).sort();
    console.log(`📅 Simulating ${sortedTimestamps.length} time periods`);

    let previousValue = this.config.initial_capital;

    // Process each candle/timestamp
    for (let i = 0; i < sortedTimestamps.length; i++) {
      const timestamp = sortedTimestamps[i];
      
      // Get current market data for this timestamp
      const currentCandles = this.getCurrentMarketCandles(timestamp, marketData);
      
      if (Object.keys(currentCandles).length === 0) continue;

      console.log(`⏰ [${i + 1}/${sortedTimestamps.length}] Processing ${timestamp}`);

      try {
        // Create fresh workflow engine for this candle (like autoexecute does)
        const engine = new WorkflowEngine(
          `backtest-${timestamp}-${i}`,
          this.config.workflow_id,
          this.config.user_id,
          nodes,
          edges
        );

        // Execute workflow with current candle data
        const result = await engine.execute(currentCandles);

        if (result.success && result.result) {
          // Process any trading signals from the workflow
          this.processWorkflowResults(timestamp, result.result, currentCandles);
        }

        // Record portfolio value
        const currentValue = this.calculatePortfolioValue(currentCandles);
        const dailyReturn = ((currentValue - previousValue) / previousValue) * 100;
        
        this.portfolioHistory.push({
          date: timestamp,
          value: currentValue,
          daily_return: dailyReturn
        });
        
        previousValue = currentValue;

        // Progress logging
        if (i % 50 === 0) {
          console.log(`📊 Progress: ${i}/${sortedTimestamps.length}, Portfolio: $${currentValue.toFixed(2)}`);
        }

      } catch (error) {
        console.error(`❌ Error simulating ${timestamp}:`, error);
      }
    }

    console.log(`✅ Simulation complete. ${this.trades.length} trades executed.`);
  }

  private getCurrentMarketCandles(timestamp: string, marketData: Map<string, any[]>): Record<string, any> {
    const currentCandles: Record<string, any> = {};
    
    marketData.forEach((data, symbol) => {
      const candle = data.find(d => d.date === timestamp);
      if (candle) {
        currentCandles[symbol] = candle;
      }
    });
    
    return currentCandles;
  }

  private processWorkflowResults(timestamp: string, results: any, marketData: Record<string, any>): void {
    // Scan workflow results for trading signals
    this.scanForTradingSignals(results, timestamp, marketData);
  }

  private scanForTradingSignals(data: any, timestamp: string, marketData: Record<string, any>): void {
    if (Array.isArray(data)) {
      data.forEach(item => this.scanForTradingSignals(item, timestamp, marketData));
    } else if (data && typeof data === 'object') {
      // Check if this object represents a trading signal
      if (data.action && data.symbol && ['buy', 'sell'].includes(data.action)) {
        this.executeTrade(timestamp, data, marketData);
      }
      
      // Recursively scan nested objects
      Object.values(data).forEach(value => 
        this.scanForTradingSignals(value, timestamp, marketData)
      );
    }
  }

  private executeTrade(timestamp: string, signal: any, marketData: Record<string, any>): void {
    const { action, symbol, quantity = 100 } = signal;
    const candle = marketData[symbol];
    
    if (!candle || !candle.close) {
      console.warn(`⚠️ No price data for ${symbol} at ${timestamp}`);
      return;
    }

    const price = candle.close;
    const commission = price * quantity * (this.config.commission_rate || 0.001);
    const slippage = price * (this.config.slippage_rate || 0.001);
    const effectivePrice = action === 'buy' ? price + slippage : price - slippage;

    const portfolioValueBefore = this.calculatePortfolioValue(marketData);

    if (action === 'buy') {
      const totalCost = effectivePrice * quantity + commission;
      if (this.portfolio.cash >= totalCost) {
        this.portfolio.cash -= totalCost;
        
        const currentPosition = this.portfolio.positions.get(symbol) || { quantity: 0, avgPrice: 0 };
        const newQuantity = currentPosition.quantity + quantity;
        const newAvgPrice = newQuantity > 0 
          ? ((currentPosition.avgPrice * currentPosition.quantity) + (effectivePrice * quantity)) / newQuantity
          : effectivePrice;
        
        this.portfolio.positions.set(symbol, { quantity: newQuantity, avgPrice: newAvgPrice });
        
        this.trades.push({
          timestamp,
          symbol,
          action: 'buy',
          quantity,
          price: effectivePrice,
          commission,
          slippage: slippage * quantity,
          portfolio_value_before: portfolioValueBefore,
          portfolio_value_after: this.calculatePortfolioValue(marketData)
        });
        
        console.log(`💰 BUY ${quantity} ${symbol} @ $${effectivePrice.toFixed(2)}`);
      }
    } else if (action === 'sell') {
      const position = this.portfolio.positions.get(symbol);
      if (position && position.quantity >= quantity) {
        const totalReceived = effectivePrice * quantity - commission;
        this.portfolio.cash += totalReceived;
        
        const newQuantity = position.quantity - quantity;
        if (newQuantity === 0) {
          this.portfolio.positions.delete(symbol);
        } else {
          this.portfolio.positions.set(symbol, { ...position, quantity: newQuantity });
        }
        
        this.trades.push({
          timestamp,
          symbol,
          action: 'sell',
          quantity,
          price: effectivePrice,
          commission,
          slippage: slippage * quantity,
          portfolio_value_before: portfolioValueBefore,
          portfolio_value_after: this.calculatePortfolioValue(marketData)
        });
        
        console.log(`💸 SELL ${quantity} ${symbol} @ $${effectivePrice.toFixed(2)}`);
      }
    }
  }

  private calculatePortfolioValue(marketData?: Record<string, any>): number {
    let value = this.portfolio.cash;
    
    for (const [symbol, position] of this.portfolio.positions) {
      const currentPrice = marketData?.[symbol]?.close || position.avgPrice;
      value += position.quantity * currentPrice;
    }
    
    return value;
  }

  private calculateResults(): BacktestResult {
    const finalValue = this.calculatePortfolioValue();
    const totalReturn = ((finalValue - this.config.initial_capital) / this.config.initial_capital) * 100;
    
    // Calculate win rate
    const buyTrades = this.trades.filter(t => t.action === 'buy');
    const sellTrades = this.trades.filter(t => t.action === 'sell');
    let profitableTrades = 0;
    
    // Match buy/sell pairs to calculate profitability
    sellTrades.forEach(sell => {
      const matchingBuy = buyTrades.find(buy => 
        buy.symbol === sell.symbol && 
        buy.timestamp < sell.timestamp
      );
      if (matchingBuy && sell.price > matchingBuy.price) {
        profitableTrades++;
      }
    });

    // Calculate max drawdown
    let maxDrawdown = 0;
    let peak = this.config.initial_capital;
    
    this.portfolioHistory.forEach(snapshot => {
      if (snapshot.value > peak) {
        peak = snapshot.value;
      }
      const drawdown = ((peak - snapshot.value) / peak) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    });

    // Calculate basic metrics
    const returns = this.portfolioHistory.map(h => h.daily_return).filter(r => !isNaN(r));
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const stdReturn = returns.length > 1 
      ? Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1))
      : 0;
    const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0; // Annualized

    return {
      backtest_id: 'workflow-backtest',
      total_return: totalReturn,
      annualized_return: (Math.pow(finalValue / this.config.initial_capital, 252 / this.portfolioHistory.length) - 1) * 100,
      final_portfolio_value: finalValue,
      total_trades: this.trades.length,
      profitable_trades: profitableTrades,
      win_rate: sellTrades.length > 0 ? (profitableTrades / sellTrades.length) * 100 : 0,
      max_drawdown: maxDrawdown,
      sharpe_ratio: sharpeRatio,
      largest_win: Math.max(...this.trades.map(t => t.portfolio_value_after - t.portfolio_value_before), 0),
      largest_loss: Math.min(...this.trades.map(t => t.portfolio_value_after - t.portfolio_value_before), 0),
      average_trade_return: this.trades.length > 0 
        ? this.trades.reduce((sum, t) => sum + (t.portfolio_value_after - t.portfolio_value_before), 0) / this.trades.length
        : 0,
      trades: this.trades,
      portfolio_history: this.portfolioHistory
    };
  }
}