// Professional Event-Driven Backtesting Engine Core Types

export interface MarketDataEvent {
  type: 'MARKET_DATA';
  timestamp: Date;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adj_close?: number;
}

export interface SignalEvent {
  type: 'SIGNAL';
  timestamp: Date;
  symbol: string;
  direction: 'LONG' | 'SHORT' | 'EXIT';
  strength: number; // 0-1 confidence
  metadata?: any;
}

export interface OrderEvent {
  type: 'ORDER';
  timestamp: Date;
  symbol: string;
  order_type: 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
  direction: 'BUY' | 'SELL';
  quantity: number;
  price?: number; // For limit orders
  stop_price?: number; // For stop orders
  time_in_force: 'GTC' | 'IOC' | 'FOK' | 'DAY';
  metadata?: any;
}

export interface FillEvent {
  type: 'FILL';
  timestamp: Date;
  symbol: string;
  direction: 'BUY' | 'SELL';
  quantity: number;
  fill_price: number;
  commission: number;
  slippage: number;
  order_id: string;
}

export type BacktestEvent = MarketDataEvent | SignalEvent | OrderEvent | FillEvent;

export interface Position {
  symbol: string;
  quantity: number;
  avg_cost: number;
  unrealized_pnl: number;
  realized_pnl: number;
  market_value: number;
  side: 'LONG' | 'SHORT' | 'FLAT';
}

export interface Portfolio {
  cash: number;
  total_value: number;
  positions: Map<string, Position>;
  daily_returns: number[];
  equity_curve: Array<{ date: Date; value: number }>;
  drawdowns: Array<{ date: Date; drawdown: number }>;
}

export interface PerformanceMetrics {
  // Returns
  total_return: number;
  annualized_return: number;
  monthly_returns: number[];
  
  // Risk Metrics
  volatility: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  calmar_ratio: number;
  
  // Drawdown Analysis
  max_drawdown: number;
  max_drawdown_duration: number;
  avg_drawdown: number;
  
  // Trade Analysis
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  profit_factor: number;
  avg_trade_pnl: number;
  avg_win: number;
  avg_loss: number;
  largest_win: number;
  largest_loss: number;
  
  // Risk Management
  var_95: number; // Value at Risk 95%
  cvar_95: number; // Conditional Value at Risk 95%
  max_leverage: number;
  
  // Benchmark Comparison
  beta?: number;
  alpha?: number;
  information_ratio?: number;
  tracking_error?: number;
}