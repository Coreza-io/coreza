import { BacktestConfig, BacktestResult } from './types';
import { WorkflowEngine } from '../workflowEngine';
import { WorkflowNode, WorkflowEdge } from '../../nodes/types';
import { DataService } from '../data';
import { BacktestContextManager } from './BacktestExecutionContext';

export class WorkflowBacktestEngine {
  private backtestContext: BacktestContextManager;
  private trades: any[] = [];
  private portfolioHistory: Array<{ date: string; value: number; daily_return: number }> = [];

  constructor(
    private config: BacktestConfig,
    private nodes: WorkflowNode[],
    private edges: WorkflowEdge[]
  ) {
    this.backtestContext = new BacktestContextManager(config);
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
    // Use iterative approach to avoid recursion stack overflow
    const queue = [results];
    const visited = new WeakSet();
    
    while (queue.length > 0) {
      const current = queue.shift();
      
      if (!current) continue;
      
      if (typeof current === 'string' && current.match(/^[A-Z]{1,5}$/)) {
        symbols.add(current);
      } else if (Array.isArray(current)) {
        if (!visited.has(current)) {
          visited.add(current);
          queue.push(...current);
        }
      } else if (current && typeof current === 'object') {
        if (!visited.has(current)) {
          visited.add(current);
          Object.entries(current).forEach(([key, value]) => {
            if (key.toLowerCase().includes('symbol') && typeof value === 'string') {
              symbols.add(value);
            }
            queue.push(value);
          });
        }
      }
    }
  }

  private async loadHistoricalData(symbols: string[]): Promise<Map<string, any[]>> {
    console.log('📈 Loading historical data via workflow nodes...');
    const marketData = new Map<string, any[]>();
    
    // Find broker or data source nodes in the workflow
    const dataNodes = this.nodes.filter(n => 
      ['Alpaca', 'Dhan', 'AlpacaTrade', 'DhanTrade', 'FinnHub', 'YahooFinance', 'Market'].includes(n.type)
    );

    if (dataNodes.length === 0) {
      console.warn('⚠️ No data source nodes found in workflow, using default YahooFinance');
      // Fallback to YahooFinance
      for (const symbol of symbols) {
        try {
          const result = await DataService.execute('yahoofinance', 'get_historical_data', {
            symbol,
            start_date: this.config.start_date,
            end_date: this.config.end_date,
            interval: this.config.data_frequency || '1d'
          });

          if (result.success && result.data && Array.isArray(result.data)) {
            marketData.set(symbol, result.data);
            console.log(`✅ Loaded ${result.data.length} candles for ${symbol} via YahooFinance`);
          }
        } catch (error) {
          console.error(`❌ Failed to load data for ${symbol}:`, error);
        }
      }
      return marketData;
    }

    // Execute data nodes with backtest context to get historical data
    for (const symbol of symbols) {
      for (const dataNode of dataNodes) {
        try {
          console.log(`📊 Loading ${symbol} data via ${dataNode.type} node`);
          
          // Create workflow engine with backtest context
          const engine = new WorkflowEngine(
            `data-load-${symbol}`,
            this.config.workflow_id,
            this.config.user_id,
            [dataNode], // Only execute the data node
            []
          );

          // Prepare input with symbol and backtest context
          const input = {
            symbol,
            ...this.backtestContext.resolveNodeParameters(dataNode, { symbol })
          };

          const result = await engine.execute(input);
          
          if (result.success && result.result && Array.isArray(result.result)) {
            marketData.set(symbol, result.result);
            console.log(`✅ Loaded ${result.result.length} candles for ${symbol} via ${dataNode.type}`);
            break; // Successfully loaded data for this symbol
          } else if (result.success && result.result && result.result.data && Array.isArray(result.result.data)) {
            marketData.set(symbol, result.result.data);
            console.log(`✅ Loaded ${result.result.data.length} candles for ${symbol} via ${dataNode.type}`);
            break;
          }
        } catch (error) {
          console.error(`❌ Failed to load data for ${symbol} via ${dataNode.type}:`, error);
        }
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

    // Create ONE workflow engine and reuse it instead of creating new ones
    const engine = new WorkflowEngine(
      `backtest-simulation`,
      this.config.workflow_id,
      this.config.user_id,
      nodes,
      edges
    );

    // Process each candle/timestamp
    for (let i = 0; i < sortedTimestamps.length; i++) {
      const timestamp = sortedTimestamps[i];
      
      // Get current market data for this timestamp
      const currentCandles = this.getCurrentMarketCandles(timestamp, marketData);
      
      if (Object.keys(currentCandles).length === 0) continue;

      console.log(`⏰ [${i + 1}/${sortedTimestamps.length}] Processing ${timestamp}`);

      try {
        // Update backtest context with current market data
        this.backtestContext.updateMarketData(timestamp, currentCandles);

        // Execute workflow with backtest context - reusing same engine
        const result = await engine.execute(currentCandles, this.backtestContext);

        if (result.success && result.result) {
          // Process any trading signals from the workflow
          this.processWorkflowResults(timestamp, result.result, currentCandles);
        }

        // Record portfolio value
        const currentValue = this.backtestContext.getPortfolioValue();
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
    // Use iterative approach to avoid recursion stack overflow
    const queue = [data];
    const visited = new WeakSet();
    
    while (queue.length > 0) {
      const current = queue.shift();
      
      if (!current) continue;
      
      if (Array.isArray(current)) {
        if (!visited.has(current)) {
          visited.add(current);
          queue.push(...current);
        }
      } else if (current && typeof current === 'object') {
        if (visited.has(current)) continue;
        visited.add(current);
        
        // Enhanced signal detection patterns
        
        // Pattern 1: Direct action signals
        if (current.action && current.symbol && ['buy', 'sell', 'BUY', 'SELL'].includes(current.action.toUpperCase())) {
          this.executeTrade(timestamp, {
            action: current.action.toLowerCase(),
            symbol: current.symbol,
            quantity: current.quantity || current.size || 100
          }, marketData);
          continue;
        }
        
        // Pattern 2: Trading signals with direction
        if (current.signal && current.symbol && ['LONG', 'SHORT', 'EXIT', 'BUY', 'SELL'].includes(current.signal.toUpperCase())) {
          const action = current.signal.toUpperCase() === 'LONG' ? 'buy' : 
                       current.signal.toUpperCase() === 'SHORT' ? 'sell' : 
                       current.signal.toLowerCase();
          this.executeTrade(timestamp, {
            action,
            symbol: current.symbol,
            quantity: current.quantity || current.size || 100
          }, marketData);
          continue;
        }
        
        // Pattern 3: Boolean buy/sell flags
        if (current.symbol && (current.buy === true || current.sell === true)) {
          const action = current.buy ? 'buy' : 'sell';
          this.executeTrade(timestamp, {
            action,
            symbol: current.symbol,
            quantity: current.quantity || 100
          }, marketData);
          continue;
        }
        
        // Pattern 4: Numeric buy/sell indicators (positive = buy, negative = sell)
        if (current.symbol && typeof current.position === 'number' && current.position !== 0) {
          const action = current.position > 0 ? 'buy' : 'sell';
          this.executeTrade(timestamp, {
            action,
            symbol: current.symbol,
            quantity: Math.abs(current.position)
          }, marketData);
          continue;
        }
        
        // Add nested objects to queue for processing
        queue.push(...Object.values(current));
      }
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
      if (this.backtestContext.portfolio.cash >= totalCost) {
        this.backtestContext.portfolio.cash -= totalCost;
        
        const currentPosition = this.backtestContext.portfolio.positions.get(symbol) || { quantity: 0, avgPrice: 0 };
        const newQuantity = currentPosition.quantity + quantity;
        const newAvgPrice = newQuantity > 0 
          ? ((currentPosition.avgPrice * currentPosition.quantity) + (effectivePrice * quantity)) / newQuantity
          : effectivePrice;
        
        this.backtestContext.portfolio.positions.set(symbol, { quantity: newQuantity, avgPrice: newAvgPrice });
        
        this.trades.push({
          timestamp,
          symbol,
          action: 'buy',
          quantity,
          price: effectivePrice,
          commission,
          slippage: slippage * quantity,
          portfolio_value_before: portfolioValueBefore,
          portfolio_value_after: this.backtestContext.getPortfolioValue()
        });
        
        console.log(`💰 BUY ${quantity} ${symbol} @ $${effectivePrice.toFixed(2)}`);
      }
    } else if (action === 'sell') {
      const position = this.backtestContext.portfolio.positions.get(symbol);
      if (position && position.quantity >= quantity) {
        const totalReceived = effectivePrice * quantity - commission;
        this.backtestContext.portfolio.cash += totalReceived;
        
        const newQuantity = position.quantity - quantity;
        if (newQuantity === 0) {
          this.backtestContext.portfolio.positions.delete(symbol);
        } else {
          this.backtestContext.portfolio.positions.set(symbol, { ...position, quantity: newQuantity });
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
          portfolio_value_after: this.backtestContext.getPortfolioValue()
        });
        
        console.log(`💸 SELL ${quantity} ${symbol} @ $${effectivePrice.toFixed(2)}`);
      }
    }
  }

  private calculatePortfolioValue(marketData?: Record<string, any>): number {
    return this.backtestContext.getPortfolioValue();
  }

  private calculateResults(): BacktestResult {
    const finalValue = this.backtestContext.getPortfolioValue();
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