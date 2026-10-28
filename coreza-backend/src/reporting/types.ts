export interface BacktestResultMetrics {
  metrics_context?: Record<string, unknown>;
  base_currency?: string | null;
  metrics_updated_at?: string | null;
  total_return?: number;
  annualized_return?: number;
  sharpe_ratio?: number;
  max_drawdown?: number;
  win_rate?: number;
  total_trades?: number;
  profitable_trades?: number;
  average_trade_return?: number;
  largest_win?: number;
  largest_loss?: number;
  final_portfolio_value?: number;
  sortino_ratio?: number;
  calmar_ratio?: number;
  profit_factor?: number;
  avg_win?: number;
  avg_loss?: number;
  total_commission?: number;
  total_slippage?: number;
  net_profit?: number;
  losing_trades?: number;
  expectancy?: number;
  avg_holding_period?: number;
}

