import { useScopedLoader } from "./useScopedLoader";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { BacktestStatus } from "./useBacktests";

import type { BacktestResultMetrics } from "../../coreza-backend/src/reporting/types";
export type { BacktestResultMetrics } from "../../coreza-backend/src/reporting/types";
import { reportingPages } from "@/lib/reportingPages";

export interface TradeOrder {
  id: string;
  symbol: string;
  side: string;
  orderType?: string;
  fillPrice: number;
  quantity: number;
  status?:
    | "Partial"
    | "Filled"
    | "Cancelled"
    | "Rejected"
    | "Expired";
  exitReason?: string;
  time: string;
}

export interface BacktestTrade {
  id: string;
  live_strategy_id: string;
  symbol: string;
  action: string;
  quantity: number;
  entryPrice: number | null;
  entryTime: string | null;
  exitPrice: number | null;
  exitTime: string | null;
  commission?: number | null;
  slippage?: number | null;
  portfolio_value_before?: number | null;
  portfolio_value_after?: number | null;
  exit_reason?: string | null;
  return_pct?: number | null;
  net_pnl?: number | null;
  holding_period_bars?: number | null;
  grossPnl?: number | null;
  fees?: number | null;
  result?: "Win" | "Loss" | null;
  orders?: TradeOrder[];
}

export interface PortfolioSnapshot {
  id: string;
  live_strategy_id: string;
  date: string;
  cash_balance: number;
  stock_value: number;
  total_value: number;
  daily_return?: number;
  equity_open?: number | null;
  equity_high?: number | null;
  equity_low?: number | null;
  equity_close?: number | null;
  equity_sample_count?: number | null;
  broker?: string | null;
  credential_id?: string | null;
  base_currency?: string | null;
}

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

export const useBacktestResults = (id?: string, enabled = true) => {
  const { user } = useAuth();
  const [backtest, setBacktest] = useState<BacktestWithRelations | null>(null);
  const [metrics, setMetrics] = useState<BacktestResultMetrics | null>(null);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performLoad = useCallback(async (isCurrent: () => boolean) => {
    if (!isCurrent()) return;
    if (!enabled || !user || !id) {
      setBacktest(null);
      setMetrics(null);
      setTrades([]);
      setSnapshots([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data: backtestData, error: backtestError } = await supabase
        .from("backtests")
        .select(
          "id, name, workflow_id, status, description, start_date, end_date, initial_capital, commission_rate, slippage_rate, data_frequency, started_at, completed_at, error_message",
        )
        .eq("user_id", user.id)
        .eq("id", id)
        .single();

      if (!isCurrent()) return;
      if (backtestError) throw backtestError;
      setBacktest(backtestData as BacktestWithRelations);

      const { data: header, error: headerError } = await supabase.from("live_strategies")
        .select("*").eq("backtest_id", id).eq("mode", "backtest").eq("user_id", user.id).single();
      if (!isCurrent()) return;
      if (headerError) throw headerError;
      const [tradeRows, snapshotRows] = await Promise.all([
        reportingPages(() => supabase.from("trades").select("*").eq("live_strategy_id", header.id).order("exitTime").order("id")),
        reportingPages(() => supabase.from("portfolio").select("*").eq("live_strategy_id", header.id).order("date").order("id")),
      ]);
      if (!isCurrent()) return;
      setMetrics(header as unknown as BacktestResultMetrics);
      setTrades(tradeRows as BacktestTrade[]);
      setSnapshots(snapshotRows as PortfolioSnapshot[]);
    } catch (err: any) {
      if (!isCurrent()) return;
      console.error("Error loading backtest results", err);
      setError(err.message || "Failed to load backtest results");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [enabled, id, user?.id]);
  const loadData = useScopedLoader(`${user?.id ?? ""}:${id ?? ""}:${enabled}`, performLoad);

  useEffect(() => {
    setBacktest(null); setMetrics(null); setTrades([]); setSnapshots([]); setError(null);
    if (!enabled) {
      setBacktest(null);
      setMetrics(null);
      setTrades([]);
      setSnapshots([]);
      setLoading(false);
      setError(null);
      return;
    }

    loadData();
  }, [enabled, loadData]);

  return {
    backtest,
    metrics,
    trades,
    snapshots,
    loading,
    error,
    refetch: loadData,
  };
};
