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
  sortino_ratio?: number;
  calmar_ratio?: number;
  cagr?: number;
  volatility?: number;
  total_trades?: number;
  profit_factor?: number;
  average_trade_return?: number;
  largest_win?: number;
  largest_loss?: number;
}

export interface BacktestTrade {
  id: string;
  symbol: string;
  side: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  gross_pl: number;
  commission?: number;
  net_pl?: number;
  entry_time?: string;
  exit_time?: string;
}

export interface PortfolioSnapshot {
  id: string;
  timestamp: string;
  equity: number;
  drawdown?: number;
  cash?: number;
  positions_value?: number;
  daily_return?: number;
}

export interface BacktestWithRelations {
  id: string;
  name: string;
  workflow_id: string;
  status: BacktestStatus;
  started_at?: string;
  completed_at?: string;
  config?: any;
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
        .select('id, name, workflow_id, status, started_at, completed_at, config')
        .eq('user_id', user.id)
        .eq('id', id)
        .single();

      if (backtestError) throw backtestError;
      setBacktest(backtestData as BacktestWithRelations);

      const [{ data: metricsData }, { data: tradesData }, { data: snapshotsData }] = await Promise.all([
        supabase.from('backtest_results').select('*').eq('backtest_id', id).maybeSingle(),
        supabase.from('backtest_trades').select('*').eq('backtest_id', id).order('entry_time', { ascending: true }),
        supabase.from('backtest_portfolio_snapshots').select('*').eq('backtest_id', id).order('timestamp', { ascending: true }),
      ]);

      if (metricsData) {
        setMetrics(metricsData as BacktestResultMetrics);
      }

      setTrades((tradesData || []) as BacktestTrade[]);
      setSnapshots((snapshotsData || []) as PortfolioSnapshot[]);
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
