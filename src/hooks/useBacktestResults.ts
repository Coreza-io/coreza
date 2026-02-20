import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { BacktestStatus } from "./useBacktests";

export interface BacktestResultMetrics {
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

// Matches backtest_trades table schema
export interface BacktestTrade {
  id: string;
  backtest_id: string;
  symbol: string;
  action: string;
  quantity: number;
  price: number;
  timestamp: string;
  commission?: number;
  slippage?: number;
  portfolio_value_before?: number;
  portfolio_value_after?: number;
  entry_price?: number;
  exit_reason?: string;
  return_pct?: number;
  net_pnl?: number;
  holding_period_bars?: number;
}

// Equity curve data — written by BacktestExecutor after run completes (daily-resampled from SimBroker.state.equityCurve)
export interface PortfolioSnapshot {
  id: string;
  backtest_id: string;
  date: string;
  cash_balance: number;
  stock_value: number;
  total_value: number;
  daily_return?: number;
}

// Matches backtests table schema
export interface BacktestWithRelations {
  id: string;
  name: string;
  workflow_id: string;
  status: BacktestStatus;
  description?: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  commission_rate?: number;
  slippage_rate?: number;
  data_frequency?: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
}

export const useBacktestResults = (id?: string) => {
  const { user } = useAuth();
  const [backtest, setBacktest] = useState<BacktestWithRelations | null>(null);
  const [metrics, setMetrics] = useState<BacktestResultMetrics | null>(null);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user || !id) return;
    setLoading(true);
    setError(null);
    try {
      const { data: backtestData, error: backtestError } = await supabase
        .from('backtests')
        .select('id, name, workflow_id, status, description, start_date, end_date, initial_capital, commission_rate, slippage_rate, data_frequency, started_at, completed_at, error_message')
        .eq('user_id', user.id)
        .eq('id', id)
        .single();

      if (backtestError) throw backtestError;
      setBacktest(backtestData as BacktestWithRelations);

      const [metricsResult, tradesResult, snapshotsResult] = await Promise.allSettled([
        supabase.from('backtest_results').select('*').eq('backtest_id', id).maybeSingle(),
        supabase.from('backtest_trades').select('*').eq('backtest_id', id).order('timestamp', { ascending: true }),
        supabase.from('backtest_portfolio_snapshots').select('*').eq('backtest_id', id).order('date', { ascending: true }),
      ]);

      if (metricsResult.status === 'fulfilled' && metricsResult.value.data) {
        setMetrics(metricsResult.value.data as BacktestResultMetrics);
      }

      setTrades(
        tradesResult.status === 'fulfilled' ? (tradesResult.value.data || []) as BacktestTrade[] : []
      );
      setSnapshots(
        snapshotsResult.status === 'fulfilled' ? (snapshotsResult.value.data || []) as PortfolioSnapshot[] : []
      );
    } catch (err: any) {
      console.error('Error loading backtest results', err);
      setError(err.message || 'Failed to load backtest results');
    } finally {
      setLoading(false);
    }
  }, [id, user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return { backtest, metrics, trades, snapshots, loading, error, refetch: loadData };
};
