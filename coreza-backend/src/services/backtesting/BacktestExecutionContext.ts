import { BacktestConfig } from '../backtesting';
import { WorkflowNode } from '../../nodes/types';

export interface BacktestExecutionContext {
  config: BacktestConfig;
  currentTimestamp?: string;
  currentMarketData?: Record<string, any>;
  portfolio: {
    cash: number;
    positions: Map<string, { quantity: number; avgPrice: number }>;
  };
  
  // Parameter resolution for backtest mode
  resolveNodeParameters(node: WorkflowNode, input: any): any;
  
  // Trading APIs
  getPosition(symbol: string): { quantity: number; avgPrice: number } | null;
  getCurrentPrice(symbol: string): number | null;
  getPortfolioValue(): number;
}

export class BacktestContextManager implements BacktestExecutionContext {
  public config: BacktestConfig;
  public currentTimestamp?: string;
  public currentMarketData?: Record<string, any>;
  public portfolio: {
    cash: number;
    positions: Map<string, { quantity: number; avgPrice: number }>;
  };

  constructor(config: BacktestConfig) {
    this.config = config;
    this.portfolio = {
      cash: config.initial_capital,
      positions: new Map()
    };
  }

  resolveNodeParameters(node: WorkflowNode, input: any): any {
    const resolvedParams = { ...node.values, ...input };

    // Special handling for broker nodes (Alpaca, Dhan, etc.)
    if (['Alpaca', 'Dhan', 'AlpacaTrade', 'DhanTrade'].includes(node.type)) {
      return this.resolveBrokerNodeParameters(node, resolvedParams);
    }

    // Special handling for data source nodes (FinnHub, YahooFinance)
    if (['FinnHub', 'YahooFinance', 'Market'].includes(node.type)) {
      return this.resolveDataSourceParameters(node, resolvedParams);
    }

    return resolvedParams;
  }

  private resolveBrokerNodeParameters(node: WorkflowNode, params: any): any {
    // Map backtest config to broker node parameters
    const backtestParams = {
      ...params,
      // Convert backtest date range to broker parameters
      start: this.config.start_date,
      end: this.config.end_date,
      
      // Map data frequency to broker interval format
      interval: this.mapDataFrequencyToBrokerInterval(this.config.data_frequency),
      
      // Calculate lookback days based on date range
      lookback: this.calculateLookbackDays(),
      
      // Force historical data mode for backtesting
      operation: params.operation || 'get_historical_data',
      historical: true,
      
      // Ensure we get the right symbol
      symbol: params.symbol || this.extractSymbolFromWorkflow()
    };

    console.log(`🔧 Resolved ${node.type} node parameters for backtest:`, backtestParams);
    return backtestParams;
  }

  private resolveDataSourceParameters(node: WorkflowNode, params: any): any {
    return {
      ...params,
      start_date: this.config.start_date,
      end_date: this.config.end_date,
      interval: this.config.data_frequency,
      operation: params.operation || 'get_historical_data'
    };
  }

  private mapDataFrequencyToBrokerInterval(frequency: string): string {
    const frequencyMap: Record<string, string> = {
      '1m': '1Min',
      '5m': '5Min', 
      '15m': '15Min',
      '30m': '30Min',
      '1h': '1Hour',
      '1d': '1Day',
      '1D': '1Day',
      'daily': '1Day',
      'hourly': '1Hour'
    };
    
    return frequencyMap[frequency] || '1Day';
  }

  private calculateLookbackDays(): number {
    const startDate = new Date(this.config.start_date);
    const endDate = new Date(this.config.end_date);
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(diffDays, 30); // At least 30 days for indicators
  }

  private extractSymbolFromWorkflow(): string {
    // Default symbol - this should be enhanced to extract from workflow
    return 'AAPL';
  }

  getPosition(symbol: string): { quantity: number; avgPrice: number } | null {
    return this.portfolio.positions.get(symbol) || null;
  }

  getCurrentPrice(symbol: string): number | null {
    return this.currentMarketData?.[symbol]?.close || null;
  }

  getPortfolioValue(): number {
    let value = this.portfolio.cash;
    
    for (const [symbol, position] of this.portfolio.positions) {
      const currentPrice = this.getCurrentPrice(symbol) || position.avgPrice;
      value += position.quantity * currentPrice;
    }
    
    return value;
  }

  updateMarketData(timestamp: string, marketData: Record<string, any>): void {
    this.currentTimestamp = timestamp;
    this.currentMarketData = marketData;
  }
}